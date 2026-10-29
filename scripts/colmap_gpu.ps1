<#
.SYNOPSIS
  Run COLMAP structure-from-motion on a local CUDA GPU and report registration statistics.

.DESCRIPTION
  Uses the official COLMAP Windows CUDA build (tools\colmap, see docs/environment.md). GPU SIFT makes
  exhaustive matching practical (every frame against every other), which re-links weakly textured
  parts of a capture that sequential matching loses. The resulting sparse model can be uploaded to
  Colab and converted with `ns-process-data images --skip-colmap --colmap-model-path ...` for training.

  Writes <Workspace>\colmap_gpu_metrics.json with per-step timings and model statistics.

.EXAMPLE
  .\scripts\colmap_gpu.ps1 -Images data\runs\room-gpu\images -Workspace data\runs\room-gpu
.EXAMPLE
  .\scripts\colmap_gpu.ps1 -Images data\runs\room-gpu\images -Workspace data\runs\room-gpu -Mapper global
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Images,
  [Parameter(Mandatory = $true)][string]$Workspace,
  [string]$Colmap = 'tools\colmap\bin\colmap.exe',
  [ValidateSet('exhaustive', 'sequential')][string]$Matching = 'exhaustive',
  [ValidateSet('incremental', 'global')][string]$Mapper = 'incremental',
  [string]$CameraModel = 'OPENCV',
  [int]$MaxFeatures = 8192,
  [switch]$ReuseFeatures
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Colmap)) { throw "COLMAP not found at $Colmap (see docs/environment.md)." }
$colmapDir = Join-Path $Workspace 'colmap'
$db = Join-Path $colmapDir 'database.db'
$sparse = Join-Path $colmapDir "sparse_$Mapper"
New-Item -ItemType Directory -Force $colmapDir | Out-Null
if (Test-Path $sparse) { Remove-Item -Recurse -Force $sparse }
New-Item -ItemType Directory -Force $sparse | Out-Null
$metrics = [ordered]@{ images = (Get-ChildItem $Images -File).Count; matching = $Matching; mapper = $Mapper; max_features = $MaxFeatures }

function Step([string]$name, [scriptblock]$cmd) {
  Write-Host "== $name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $cmd } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit code $LASTEXITCODE)" }
  $metrics["${name}_seconds"] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
}

if (-not $ReuseFeatures -or -not (Test-Path $db)) {
  Remove-Item -Force $db -ErrorAction SilentlyContinue
  Step 'extract' { & $Colmap feature_extractor --database_path $db --image_path $Images `
      --ImageReader.single_camera 1 --ImageReader.camera_model $CameraModel `
      --FeatureExtraction.use_gpu 1 --SiftExtraction.max_num_features $MaxFeatures }
  Step 'match' { & $Colmap "${Matching}_matcher" --database_path $db --FeatureMatching.use_gpu 1 }
}
if ($Mapper -eq 'global') {
  Step 'map' { & $Colmap global_mapper --database_path $db --image_path $Images --output_path $sparse }
} else {
  Step 'map' { & $Colmap mapper --database_path $db --image_path $Images --output_path $sparse }
}

# Report every model the mapper produced, largest first.
$models = @()
$ErrorActionPreference = 'Continue'  # COLMAP logs to stderr; judge by the parsed output instead
foreach ($m in Get-ChildItem $sparse -Directory) {
  $out = & $Colmap model_analyzer --path $m.FullName 2>&1 | Out-String
  $reg = [int]([regex]::Match($out, 'Registered images:\s*(\d+)').Groups[1].Value)
  $pts = [int]([regex]::Match($out, 'Points:\s*(\d+)').Groups[1].Value)
  $err = [double]([regex]::Match($out, 'Mean reprojection error:\s*([\d.]+)').Groups[1].Value)
  $models += [ordered]@{ path = $m.FullName; registered = $reg; points = $pts; reproj_px = $err }
}
$models = @($models | Sort-Object { $_.registered } -Descending)
$metrics['models'] = $models
if ($models.Count) {
  $metrics['best_registered'] = $models[0].registered
  $metrics['best_ratio'] = [math]::Round($models[0].registered / $metrics.images, 3)
}
[IO.File]::WriteAllText((Resolve-Path $Workspace).Path + '\colmap_gpu_metrics.json', ($metrics | ConvertTo-Json -Depth 5))
$metrics | ConvertTo-Json -Depth 5
