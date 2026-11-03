param(
    [Parameter(Mandatory = $true)]
    [string]$CollectionRoot
)
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $CollectionRoot).Path
$rows = @()
foreach ($directory in Get-ChildItem -LiteralPath $resolvedRoot -Directory) {
    $files = @(Get-ChildItem -LiteralPath $directory.FullName -File -Filter '*.png')
    $zero = 0
    $badHeader = 0
    [long]$totalBytes = 0
    foreach ($file in $files) {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $totalBytes += $bytes.Length
        if ($bytes.Length -eq 0) { $zero++ }
        if ($bytes.Length -lt 8 -or (($bytes[0..7] -join '-') -ne '137-80-78-71-13-10-26-10')) {
            $badHeader++
        }
    }
    $rows += [pscustomobject]@{
        Keyword = $directory.Name
        Count = $files.Count
        ZeroBytes = $zero
        BadPNGHeader = $badHeader
        TotalBytes = $totalBytes
    }
}
$rows | ConvertTo-Json -Depth 3
if (-not $rows.Count -or ($rows | Measure-Object -Property Count -Sum).Sum -eq 0) {
    throw 'No PNG files found in keyword subdirectories.'
}
if (@($rows | Where-Object { $_.ZeroBytes -gt 0 -or $_.BadPNGHeader -gt 0 }).Count -gt 0) {
    throw 'Empty files or invalid PNG signatures found.'
}
