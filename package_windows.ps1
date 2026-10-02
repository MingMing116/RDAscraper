# Run after build_windows.ps1. Includes the guide and offline license notices.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$stage = Join-Path $PSScriptRoot 'dist/package'
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item 'dist/RDAscraper.exe' $stage
Copy-Item 'docs/RDAscraper_Quick_Guide.pdf' $stage
Copy-Item 'docs/WINDOWS_README_KO.txt' (Join-Path $stage '사용안내.txt')
Copy-Item 'web/licenses' (Join-Path $stage 'licenses') -Recurse
Copy-Item 'docs/THIRD_PARTY.md' (Join-Path $stage 'licenses/THIRD_PARTY.md')
foreach ($name in @('standard_fonts', 'wasm', 'cmaps')) {
    $target = Join-Path $stage "licenses/$name"
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item "web/vendor/$name/LICENSE*" $target
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'licenses/ocr') | Out-Null
Copy-Item 'web/vendor/ocr/*.LICENSE.txt' (Join-Path $stage 'licenses/ocr')
$base = (Resolve-Path $stage).Path
$lines = Get-ChildItem $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $relative"
}
[IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS.txt'), [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
$archive = 'dist/RDAscraper_Windows_x64.zip'
Compress-Archive -Path "$stage/*" -DestinationPath $archive -Force
$outer = foreach ($name in @('RDAscraper.exe', 'RDAscraper_Windows_x64.zip')) {
    "$((Get-FileHash "dist/$name" -Algorithm SHA256).Hash.ToLowerInvariant())  $name"
}
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'dist/SHA256SUMS.txt'), [string[]]$outer, (New-Object Text.UTF8Encoding($false)))
