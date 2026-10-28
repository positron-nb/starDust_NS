<#
.SYNOPSIS
  Namma Space reconstruction pipeline (Windows / PowerShell).

  video|images -> frame extraction -> quality gate -> COLMAP (ns-process-data) -> registration gate
  -> Splatfacto training -> Gaussian-splat export -> web model + draft viewer manifest.

.DESCRIPTION
  Each run lives in its own folder (default data\runs\<run-id>) and every output is bound to that
  run: frames, COLMAP output, the training config (recorded in run_metrics.json), the export, and
  the web model public\models\<run-id>.sog with draft manifest public\models\<run-id>.manifest.json.
  The live viewer (public\models\manifest.json) is never changed by this script. You publish a run
  after calibrating it (README, "Replacing the model").

  Every native command is checked immediately. Each stage clears its own outputs first and
  verifies they were freshly produced, so stale files from an earlier run cannot be picked up.

  Requires ns-process-data, ns-train, ns-export and colmap on PATH (docs/environment.md), or use
  notebooks/namma_space_colab.ipynb, which runs scripts/run_reconstruction.sh.

.EXAMPLE
  .\scripts\run_reconstruction.ps1 -Video capture\room.mp4
.EXAMPLE
  .\scripts\run_reconstruction.ps1 -Images capture\photos -Matching exhaustive -RunId bedroom-v2
.EXAMPLE
  .\scripts\run_reconstruction.ps1 -RunId bedroom-v2 -SkipTo export
#>
[CmdletBinding()]
param(
  [string]$Video,
  [string]$Images,
  [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$RunsRoot = 'data\runs',
  [double]$Fps = 2,
  [int]$MaxWidth = 1600,
  [int]$MinFrames = 40,
  [double]$MinRegistered = 0.7,
  [ValidateSet('sequential', 'exhaustive', 'vocab_tree')][string]$Matching = 'sequential',
  [ValidateSet('splatfacto', 'splatfacto-big')][string]$Method = 'splatfacto',
  [int]$MaxIters = 30000,
  [ValidateSet('frames', 'colmap', 'train', 'export', 'web')][string]$SkipTo = 'frames',
  [string]$ModelOut = 'public\models',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$stages = @('frames', 'colmap', 'train', 'export', 'web')
$startIdx = [array]::IndexOf($stages, $SkipTo)
if ($RunId -notmatch '^[A-Za-z0-9._-]+$' -or $RunId -match '^\.+$') {
  throw "RunId may only contain letters, digits, '.', '_' and '-', and cannot be only dots."
}

$Workspace = Join-Path $RunsRoot $RunId
# The run folder must be a direct child of the runs root; checked before anything is deleted.
$runsRootFull = [IO.Path]::GetFullPath((Join-Path (Get-Location) $RunsRoot)).TrimEnd('\', '/')
$workspaceFull = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Workspace)).TrimEnd('\', '/')
if ((Split-Path $workspaceFull -Parent) -ne $runsRootFull -or (Split-Path $workspaceFull -Leaf) -ne $RunId) {
  throw "Run folder $workspaceFull does not resolve inside $runsRootFull; refusing to continue."
}
$imagesDir = Join-Path $Workspace 'images'
$processed = Join-Path $Workspace 'processed'
$outputs = Join-Path $Workspace 'outputs'
$exports = Join-Path $Workspace 'exports'
$metricsPath = Join-Path $Workspace 'run_metrics.json'

if ($startIdx -eq 0 -and (Test-Path $Workspace) -and (Get-ChildItem $Workspace -Force | Select-Object -First 1)) {
  if (-not $Force) { throw "Run folder $Workspace already exists. Use a new -RunId, -SkipTo a later stage, or -Force to start it over." }
  Remove-Item -Recurse -Force -LiteralPath $workspaceFull
}
if ($startIdx -gt 0 -and -not (Test-Path $metricsPath)) { throw "No run_metrics.json in $Workspace; cannot resume run '$RunId'." }
New-Item -ItemType Directory -Force $Workspace | Out-Null

$metrics = [ordered]@{}
if (Test-Path $metricsPath) {
  (Get-Content $metricsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $metrics[$_.Name] = $_.Value }
}
$metrics['run_id'] = $RunId
function Save-Metrics { [IO.File]::WriteAllText((Resolve-Path $Workspace).Path + '\run_metrics.json', ($metrics | ConvertTo-Json -Depth 5)) }

# Run a native command and fail immediately on a non-zero exit code. Success is judged by the
# exit code only: nerfstudio, COLMAP and splat-transform log progress to stderr, which Windows
# PowerShell 5.1 would otherwise turn into terminating errors when output is redirected.
function Invoke-Native([string]$what, [scriptblock]$cmd) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $cmd } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}
function Reset-Dir([string]$dir) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Force $dir | Out-Null
}
function Assert-Fresh([string]$path, [datetime]$since, [string]$what) {
  if (-not (Test-Path $path)) { throw "$what was not produced: $path" }
  if ((Get-Item $path).LastWriteTime -lt $since) { throw "$what is stale (older than this stage): $path" }
}
function Require-Tool([string]$tool) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' not found on PATH. See docs/environment.md, or use notebooks/namma_space_colab.ipynb."
  }
}
function Invoke-Stage([string]$name, [scriptblock]$body) {
  if ([array]::IndexOf($stages, $name) -lt $startIdx) { Write-Host "== skip $name"; return }
  Write-Host "== $name ($RunId)" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $script:stageStart = Get-Date
  & $body
  $metrics["${name}_seconds"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  Save-Metrics
}

Invoke-Stage 'frames' {
  Reset-Dir $imagesDir
  if ($Video) {
    Invoke-Native 'frame extraction' { python "$Root\scripts\extract_frames.py" $Video $imagesDir --fps $Fps --max-width $MaxWidth --overwrite }
    $metrics['input'] = (Resolve-Path $Video).Path
  } elseif ($Images) {
    $src = Get-ChildItem $Images -File | Where-Object { $_.Extension -match '^\.(jpe?g|png)$' }
    if (-not $src) { throw "No .jpg/.jpeg/.png images in $Images" }
    $src | Copy-Item -Destination $imagesDir
    $metrics['input'] = (Resolve-Path $Images).Path
  } else { throw 'Pass -Video or -Images (or -SkipTo a later stage with an existing -RunId).' }
  Invoke-Native 'quality gate' { python "$Root\scripts\check_images.py" $imagesDir --move-rejects --min-frames $MinFrames }
  $metrics['frames_used'] = (Get-ChildItem $imagesDir -File).Count
}

Invoke-Stage 'colmap' {
  Require-Tool 'ns-process-data'; Require-Tool 'colmap'
  Reset-Dir $processed
  Invoke-Native 'COLMAP (ns-process-data)' { ns-process-data images --data $imagesDir --output-dir $processed --matching-method $Matching }
  $tf = Join-Path $processed 'transforms.json'
  Assert-Fresh $tf $stageStart 'transforms.json'
  $registered = ((Get-Content $tf -Raw | ConvertFrom-Json).frames).Count
  $used = (Get-ChildItem $imagesDir -File).Count
  $ratio = if ($used) { [math]::Round($registered / $used, 3) } else { 0 }
  $metrics['registered_cameras'] = $registered
  $metrics['registration_ratio'] = $ratio
  Save-Metrics
  if ($ratio -lt $MinRegistered) {
    throw "Only $registered of $used frames registered (ratio $ratio < $MinRegistered). Check the COLMAP log, re-capture weak areas, or try -Matching exhaustive."
  }
}

Invoke-Stage 'train' {
  Require-Tool 'ns-train'
  Reset-Dir $outputs
  # Fixed experiment name + timestamp make the config path belong to this run only.
  Invoke-Native 'Splatfacto training' {
    ns-train $Method --data $processed --output-dir $outputs --experiment-name $RunId --timestamp run `
      --max-num-iterations $MaxIters --viewer.quit-on-train-completion True
  }
  $configs = @(Get-ChildItem $outputs -Recurse -Filter config.yml)
  if ($configs.Count -ne 1) { throw "Expected exactly one config.yml under $outputs, found $($configs.Count)." }
  $metrics['config_path'] = $configs[0].FullName
  $metrics['method'] = $Method
  $metrics['max_iterations'] = $MaxIters
}

Invoke-Stage 'export' {
  Require-Tool 'ns-export'
  $config = $metrics['config_path']
  if (-not $config -or -not (Test-Path $config)) { throw "Training config for run $RunId not found ($config)." }
  Reset-Dir $exports
  Invoke-Native 'Gaussian-splat export' { ns-export gaussian-splat --load-config $config --output-dir $exports }
  $plys = @(Get-ChildItem $exports -Filter *.ply)
  if ($plys.Count -ne 1) { throw "Expected exactly one .ply in $exports, found $($plys.Count)." }
  Assert-Fresh $plys[0].FullName $stageStart 'exported PLY'
  $metrics['export_ply'] = $plys[0].FullName
  $metrics['export_ply_bytes'] = $plys[0].Length
}

Invoke-Stage 'web' {
  $ply = $metrics['export_ply']
  if (-not $ply -or -not (Test-Path $ply)) { throw "Exported PLY for run $RunId not found ($ply)." }
  New-Item -ItemType Directory -Force $ModelOut | Out-Null
  $sog = Join-Path $ModelOut "$RunId.sog"
  $draft = Join-Path $ModelOut "$RunId.manifest.json"
  Remove-Item -Force $sog, $draft -ErrorAction SilentlyContinue
  # splat-transform (PlayCanvas, MIT): drop NaN splats and pack into the compressed SOG format.
  Invoke-Native 'SOG conversion' { npx --yes @playcanvas/splat-transform@3.10.1 $ply --filter-nan $sog -w }
  Assert-Fresh $sog $stageStart 'SOG web model'
  Invoke-Native 'splat inspection' {
    python "$Root\scripts\splat_info.py" $ply --up z --json (Join-Path $Workspace 'splat_info.json') `
      --manifest-out $draft --model-file "models/$RunId.sog" --name "Reconstructed room $RunId (uncalibrated draft)"
  }
  Assert-Fresh $draft $stageStart 'draft manifest'
  $metrics['web_model'] = $sog
  $metrics['web_model_bytes'] = (Get-Item $sog).Length
  $metrics['draft_manifest'] = $draft
  Write-Host "Web model: $sog"
  Write-Host "Calibrate: npm run dev, then http://localhost:5173/?calibrate&manifest=models/$RunId.manifest.json"
}

Save-Metrics
Write-Host "Done. Metrics: $metricsPath" -ForegroundColor Green
