# Developer build script. End users run the prebuilt RDAscraper.exe directly.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'
New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
go build -buildvcs=false -trimpath -ldflags '-s -w -H=windowsgui' -o dist/RDAscraper.exe .
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
Get-FileHash dist/RDAscraper.exe -Algorithm SHA256
