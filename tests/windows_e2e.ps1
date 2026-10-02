param(
    [string]$Binary = 'dist/RDAscraper.exe',
    [switch]$Headed,
    [switch]$SyntheticOnly
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'This entrypoint requires native Windows. Linux, WSL, and Wine results are not native Windows validation.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$oldBinary = $env:RDA_TEST_BINARY
$oldHeaded = $env:RDA_TEST_HEADED
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Developer check requires Node.js 24 and npm ci. End users do not need these tools.'
    }
    if (-not (Test-Path 'node_modules/playwright/package.json')) {
        throw 'Run npm ci in the source directory first. This script does not install software.'
    }
    $env:RDA_TEST_BINARY = (Resolve-Path $Binary).Path
    $env:RDA_TEST_HEADED = if ($Headed) { '1' } else { '0' }
    Write-Host 'Native Windows test binary:' $env:RDA_TEST_BINARY
    Write-Host 'SHA256:' (Get-FileHash $env:RDA_TEST_BINARY -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($SyntheticOnly) {
        # Existing controlled regression uses Playwright Chromium (development-only installation).
        & node tests/browser_test.mjs
    } else {
        # Uses installed Edge by default, real network, an isolated temporary project and no replay.
        & node tests/live_browser_test.mjs
    }
    if ($LASTEXITCODE -ne 0) { throw 'The Windows browser check failed. Read tests/artifacts for the failed step and actual connection errors.' }
    $record = if ($SyntheticOnly) { 'tests/artifacts/browser/validation.json' } else { 'tests/artifacts/live_browser/validation.json' }
    $result = Get-Content -Raw $record | ConvertFrom-Json
    if ($result.nativeWindows -ne $true -or $result.platform -ne 'win32') {
        throw 'The evidence does not report a native Windows process.'
    }
    if (-not $SyntheticOnly -and $result.status -ne 'PASS') { throw 'Live public-news verification did not pass.' }
    Write-Host 'Evidence:' (Resolve-Path $record).Path
} finally {
    $env:RDA_TEST_BINARY = $oldBinary
    $env:RDA_TEST_HEADED = $oldHeaded
    Pop-Location
}
