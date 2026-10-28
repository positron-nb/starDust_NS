<#
.SYNOPSIS
  Namma Space reconstruction pipeline (Windows / PowerShell).

  video|images -> frame extraction -> quality check -> COLMAP (ns-process-data)
  -> Splatfacto training -> Gaussian-splat export -> web-ready conversion.

.DESCRIPTION
  Requires an environment where `ns-process-data`, `ns-train`, `ns-export` and `colmap`
  are on PATH (see docs/environment.md). On machines without a working CUDA build of
  nerfstudio/gsplat, use notebooks/namma_space_colab.ipynb instead; it runs the same
  steps through scripts/run_reconstruction.sh.

  Every stage writes timings into <Workspace>/run_metrics.json so measured numbers can be
  copied into submission/metrics.md without retyping.

.EXAMPLE
  .\scripts\run_reconstruction.ps1 -Video capture\room.mp4 -Workspace data\room
.EXAMPLE
  .\scripts\run_reconstruction.ps1 -Images data\room\images -Workspace data\room -Matching exhaustive
.EXAMPLE
  .\scripts\run_reconstruction.ps1 -Workspace data\room -SkipTo export
#>
[CmdletBinding()]
param(
  [string]$Video,
  [string]$Images,
  [Parameter(Mandatory = $true)][string]$Workspace,
  [double]$Fps = 2,
  [int]$MaxWidth = 1600,
  [ValidateSet('sequential', 'exhaustive', 'vocab_tree')][string]$Matching = 'sequential',
  [ValidateSet('splatfacto', 'splatfacto-big')][string]$Method = 'splatfacto',
  [int]$MaxIters = 30000,
  [ValidateSet('frames', 'colmap', 'train', 'export', 'web')][string]$SkipTo = 'frames',
  [string]$ModelOut = 'public\models',
  [string]$ModelName = 'room'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$stages = @('frames', 'colmap', 'train', 'export', 'web')
$startIdx = [array]::IndexOf($stages, $SkipTo)
New-Item -ItemType Directory -Force $Workspace | Out-Null
$metricsPath = Join-Path $Workspace 'run_metrics.json'
$metrics = [ordered]@{}
if (Test-Path $metricsPath) {
  (Get-Content $metricsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $metrics[$_.Name] = $_.Value }
}

function Save-Metrics { $metrics | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $metricsPath }
function Invoke-Stage([string]$name, [scriptblock]$body) {
  if ([array]::IndexOf($stages, $name) -lt $startIdx) { Write-Host "== skip $name"; return }
  Write-Host "== $name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $body
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "$name failed with exit code $LASTEXITCODE" }
  $metrics["${name}_seconds"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  Save-Metrics
}
function Require-Tool([string]$tool) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' not found on PATH. See docs/environment.md, or use notebooks/namma_space_colab.ipynb."
  }
}

$imagesDir = Join-Path $Workspace 'images'
$processed = Join-Path $Workspace 'processed'
$outputs = Join-Path $Workspace 'outputs'
$exports = Join-Path $Workspace 'exports'

Invoke-Stage 'frames' {
  if ($Video) {
    python "$Root\scripts\extract_frames.py" $Video $imagesDir --fps $Fps --max-width $MaxWidth --overwrite
    if ($LASTEXITCODE -ne 0) { throw 'frame extraction failed' }
  } elseif ($Images) {
    if ((Resolve-Path $Images).Path -ne (Resolve-Path -LiteralPath $imagesDir -ErrorAction SilentlyContinue).Path) {
      New-Item -ItemType Directory -Force $imagesDir | Out-Null
      Copy-Item "$Images\*" $imagesDir -Include *.jpg, *.jpeg, *.png
    }
  } else { throw 'Pass -Video or -Images (or -SkipTo a later stage).' }
  python "$Root\scripts\check_images.py" $imagesDir --move-rejects
  $metrics['frames_used'] = (Get-ChildItem $imagesDir -File).Count
}

Invoke-Stage 'colmap' {
  Require-Tool 'ns-process-data'; Require-Tool 'colmap'
  ns-process-data images --data $imagesDir --output-dir $processed --matching-method $Matching
  $tf = Join-Path $processed 'transforms.json'
  if (-not (Test-Path $tf)) { throw 'COLMAP did not produce transforms.json; check the log above.' }
  $metrics['registered_cameras'] = ((Get-Content $tf -Raw | ConvertFrom-Json).frames).Count
}

Invoke-Stage 'train' {
  Require-Tool 'ns-train'
  ns-train $Method --data $processed --output-dir $outputs --max-num-iterations $MaxIters `
    --viewer.quit-on-train-completion True
  $metrics['method'] = $Method
  $metrics['max_iterations'] = $MaxIters
}

Invoke-Stage 'export' {
  Require-Tool 'ns-export'
  $config = Get-ChildItem $outputs -Recurse -Filter config.yml | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $config) { throw "No config.yml under $outputs" }
  ns-export gaussian-splat --load-config $config.FullName --output-dir $exports
  $ply = Get-ChildItem $exports -Filter *.ply | Select-Object -First 1
  $metrics['export_ply_mb'] = [math]::Round($ply.Length / 1MB, 1)
}

Invoke-Stage 'web' {
  $ply = Get-ChildItem $exports -Filter *.ply | Select-Object -First 1
  if (-not $ply) { throw "No exported .ply in $exports" }
  New-Item -ItemType Directory -Force $ModelOut | Out-Null
  $sog = Join-Path $ModelOut "$ModelName.sog"
  # splat-transform (PlayCanvas, MIT): drop NaN splats and pack into the compressed SOG format.
  npx --yes @playcanvas/splat-transform@3.10.1 $ply.FullName --filter-nan $sog -w
  python "$Root\scripts\splat_info.py" $ply.FullName --json (Join-Path $Workspace 'splat_info.json')
  $metrics['web_model'] = $sog
  $metrics['web_model_mb'] = [math]::Round((Get-Item $sog).Length / 1MB, 1)
  Write-Host "Web model written to $sog. Update public\models\manifest.json if the file name changed."
}

Save-Metrics
Write-Host "Done. Metrics: $metricsPath" -ForegroundColor Green
