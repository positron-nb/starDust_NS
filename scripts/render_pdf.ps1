<#
.SYNOPSIS
  Render an HTML document to PDF with headless Microsoft Edge (or Chrome) and report the page count.
.EXAMPLE
  .\scripts\render_pdf.ps1 submission\abstract\technical_abstract.html submission\technical_abstract.pdf -MaxPages 5
#>
param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Pdf,
  [int]$MaxPages = 0
)
$ErrorActionPreference = 'Stop'
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Edge or Chrome not found.' }

$src = (Resolve-Path $Html).Path
$out = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Pdf))
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$uri = ([Uri]$src).AbsoluteUri
$p = Start-Process -FilePath $browser -Wait -PassThru -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer', "--print-to-pdf=$out", $uri)
if (-not (Test-Path $out)) { throw "PDF was not produced (exit $($p.ExitCode))." }

# Count pages by scanning page objects (works for Chromium-generated PDFs).
$text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($out))
$pages = ([regex]::Matches($text, '/Type\s*/Page[^s]')).Count
Write-Host "$out : $pages page(s), $([math]::Round((Get-Item $out).Length / 1KB)) KB"
if ($MaxPages -gt 0 -and $pages -gt $MaxPages) { Write-Warning "Exceeds the $MaxPages-page limit."; exit 1 }
