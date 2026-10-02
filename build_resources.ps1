# Optional developer step. End users need only the prebuilt RDAscraper.exe.
# Downloads the exact resource tool through Go's module verification mechanism.
# Existing resources are replaced only after successful generation.
$ErrorActionPreference = 'Stop'
$resourceTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('rdascraper-resources-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $resourceTemp | Out-Null
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'web/assets/isaki.ico' -PathType Leaf)) {
        throw 'Application icon is missing: web/assets/isaki.ico'
    }
    $resourcePrefix = Join-Path $resourceTemp 'rsrc'
    $resourceArgs = @(
        'run', 'github.com/tc-hib/go-winres@v0.3.3', 'simply',
        '--arch', 'amd64',
        '--out', $resourcePrefix,
        '--icon', 'web/assets/isaki.ico',
        '--manifest', 'gui',
        '--file-version', '65.3.1.0',
        '--product-version', '65.3.1.0',
        '--product-name', 'RDAscraper',
        '--file-description', 'RDAscraper local news collection',
        '--original-filename', 'RDAscraper.exe'
    )
    & go @resourceArgs
    if ($LASTEXITCODE -ne 0) { throw 'Windows resource generation failed' }
    $generatedResource = Join-Path $resourceTemp 'rsrc_windows_amd64.syso'
    if (-not (Test-Path -LiteralPath $generatedResource -PathType Leaf)) {
        throw 'Resource tool did not produce the expected Windows x64 object'
    }
    if ((Get-Item -LiteralPath $generatedResource).Length -eq 0) {
        throw 'Generated resource object is empty'
    }
    Copy-Item -LiteralPath $generatedResource -Destination 'rsrc_windows_amd64.syso' -Force
    Get-FileHash -LiteralPath 'rsrc_windows_amd64.syso' -Algorithm SHA256
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $resourceTemp) {
        Remove-Item -LiteralPath $resourceTemp -Recurse -Force
    }
}
