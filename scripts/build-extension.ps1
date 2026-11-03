param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'imagegrab-extension'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $OutputPath) {
    $OutputPath = Join-Path $repoRoot ('dist/imagegrab-extension-' + $manifest.version + '.zip')
}
if (Test-Path -LiteralPath $OutputPath) {
    throw 'Output already exists. Choose a new output path to preserve the archived package.'
}
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputPath))
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
Compress-Archive -LiteralPath $source -DestinationPath $OutputPath
Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length
