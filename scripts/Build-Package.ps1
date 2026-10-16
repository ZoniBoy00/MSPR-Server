# Build-Package.ps1 - builds a ready-to-run server package from this repository:
#
#   dist\MSPR-Server\               runnable server (scripts\INSTALL/START/STOP-MSPR.cmd)
#   dist\MSPR-Server-<date>.zip     the same for sharing
#
# Contents: Horizon (built), the TypeScript server (source + lockfile), scripts, the Medius self-test tools,
# the SVO fixtures, the RPCS3 patch and the documentation. Not included: reverse engineering material, captures,
# the Horizon sources.
# Updating an existing dist\MSPR-Server keeps the user data:
#   server\data (database), server\config (EULA, announcement, mspr.json), logs\,
#   Horizon logs\ and static\mspr_accounts.json, server\node_modules.
#
#   .\scripts\Build-Package.ps1 [-OutDir <folder>]      default: <repo>\dist

param([string]$OutDir = '')

$ErrorActionPreference = 'Stop'
$scripts = Split-Path -Parent $MyInvocation.MyCommand.Path      # <repo>\scripts
$repo    = Split-Path -Parent $scripts                          # <repo>
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist' }
$target  = Join-Path $OutDir 'MSPR-Server'
$hz      = 'horizon\Servers\Horizon\bin\Release\net10.0'

if (-not (Test-Path (Join-Path $repo "$hz\Horizon.exe"))) { throw "Horizon is not built (scripts\INSTALL-MSPR.cmd -Rebuild)" }
if (Get-Process Horizon -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target*" }) {
    throw "The packaged server is running. Stop it first (dist\MSPR-Server\scripts\STOP-MSPR.cmd)."
}

function Mirror($from, $to, [string[]]$xd = @(), [string[]]$xf = @()) {
    $s = Join-Path $repo $from
    $d = Join-Path $target $to
    $rcArgs = @($s, $d, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($xd) { $rcArgs += "/XD"; $rcArgs += $xd }
    if ($xf) { $rcArgs += "/XF"; $rcArgs += $xf }
    robocopy @rcArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $from failed ($LASTEXITCODE)" }
}

$fresh = -not (Test-Path $target)
New-Item -ItemType Directory -Force $target | Out-Null

# /MIR + /XD|/XF: excluded paths are neither copied nor deleted -> user data survives updates
Mirror $hz $hz @('logs') @('mspr_accounts.json', 'mspr_accounts.json.tmp', '*.pdb')
Mirror 'scripts'        'scripts'
Mirror 'tools\medius'   'tools\medius' @('__pycache__')
Mirror 'patches'        'patches'
Mirror 'server' 'server' @('node_modules', 'data', 'dist', 'config', 'test') @('npm-install.log')
if ($fresh -or -not (Test-Path (Join-Path $target 'server\config'))) { Mirror 'server\config' 'server\config' }
New-Item -ItemType Directory -Force (Join-Path $target 'logs') | Out-Null

# documentation: README.md in the package root is the getting started guide
New-Item -ItemType Directory -Force (Join-Path $target 'docs') | Out-Null
foreach ($d in 'getting-started.md', 'api.md', 'deployment.md', 'ranked-casual.md') {
    $p = Join-Path $repo "docs\$d"
    if (Test-Path $p) { Copy-Item $p (Join-Path $target 'docs') -Force }
}
Copy-Item (Join-Path $repo 'docs\getting-started.md') (Join-Path $target 'README.md') -Force

# zip: without user data, node_modules or logs
$stamp = Get-Date -Format yyyyMMdd
$zip   = Join-Path $OutDir "MSPR-Server-$stamp.zip"
$stage = Join-Path ([IO.Path]::GetTempPath()) "MSPR-Server-$stamp"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
robocopy $target $stage /E /NFL /NDL /NJH /NJS /NP /XD node_modules logs data /XF mspr_accounts.json npm-install.log *.sqlite* | Out-Null
if (-not (Test-Path (Join-Path $stage 'server\config'))) { robocopy (Join-Path $repo 'server\config') (Join-Path $stage 'server\config') /E | Out-Null }
Copy-Item (Join-Path $repo 'server\config\*') (Join-Path $stage 'server\config') -Force   # the zip gets the default texts
New-Item -ItemType Directory -Force (Join-Path $stage 'logs') | Out-Null
Get-ChildItem $OutDir -Filter 'MSPR-Server-*.zip' | Remove-Item -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)   # forward-slash entries
Remove-Item $stage -Recurse -Force

Write-Host "Server:  $target" -ForegroundColor Green
Write-Host "Package: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)" -ForegroundColor Green
if ($fresh) { Write-Host "First time: run dist\MSPR-Server\scripts\INSTALL-MSPR.cmd" }
exit 0
