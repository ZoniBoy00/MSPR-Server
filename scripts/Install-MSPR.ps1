# Install-MSPR.ps1 - checks and installs everything the MSPR server needs
#
#   .\Install-MSPR.ps1                 # check + npm install + Horizon (build if missing)
#   .\Install-MSPR.ps1 -AutoInstall    # install a missing .NET 10 / Node.js with winget
#   .\Install-MSPR.ps1 -Firewall       # add the Windows firewall rules (needs administrator)
#   .\Install-MSPR.ps1 -Rebuild        # rebuild Horizon (needs the .NET SDK)

param([switch]$AutoInstall, [switch]$Firewall, [switch]$Rebuild)

$ErrorActionPreference = 'Stop'
$scripts = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo    = Split-Path -Parent $scripts
$horizonProj = Join-Path $repo 'horizon\Servers\Horizon'
$horizonBin  = Join-Path $horizonProj 'bin\Release\net10.0'
$ts          = Join-Path $repo 'server'
$allOk = $true

function Ok($m)   { Write-Host "[OK]      $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "[MISSING] $m" -ForegroundColor Red; $script:allOk = $false }
function Info($m) { Write-Host "          $m" -ForegroundColor Yellow }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function WingetInstall($id) {
    if (-not (Have winget)) { Info "winget is missing - install $id by hand"; return }
    winget install --id $id -e --accept-source-agreements --accept-package-agreements
}

Write-Host "=== MSPR server install ($repo) ===" -ForegroundColor Cyan

# --- .NET 10 runtime (Horizon) ---
$runtimes = if (Have dotnet) { dotnet --list-runtimes 2>$null } else { @() }
if ($runtimes -match 'Microsoft\.NETCore.App 10.') { Ok ".NET 10 runtime" }
else {
    Bad ".NET 10 runtime (needed by Horizon)"
    if ($AutoInstall) { WingetInstall 'Microsoft.DotNet.Runtime.10' } else { Info "winget install Microsoft.DotNet.Runtime.10   (or run with -AutoInstall)" }
}

# --- Node.js >= 22.13 (server, node:sqlite) ---
$nodeOk = $false
if (Have node) {
    $v = [version]((node --version).TrimStart('v'))
    $nodeOk = $v -ge [version]'22.13.0'
}
if ($nodeOk) { Ok "Node.js $(node --version)" }
else {
    Bad "Node.js 22.13+ (needed by the TypeScript server)"
    if ($AutoInstall) { WingetInstall 'OpenJS.NodeJS.LTS' } else { Info "winget install OpenJS.NodeJS.LTS   (or run with -AutoInstall)" }
}

# --- Horizon ---
if ($Rebuild -or -not (Test-Path (Join-Path $horizonBin 'Horizon.exe'))) {
    if ((Have dotnet) -and ((dotnet --list-sdks 2>$null) -match '^\d')) {
        Write-Host "Building Horizon (takes a few minutes)..." -ForegroundColor Yellow
        Push-Location $horizonProj
        cmd /c "dotnet build Horizon.csproj -c Release --no-incremental 2>&1" | Select-String -Pattern ' error |Build succeeded' | Select-Object -Last 3 | Out-Host
        Pop-Location
    } else { Info ".NET SDK missing, Horizon cannot be built (winget install Microsoft.DotNet.SDK.10)" }
}
if (Test-Path (Join-Path $horizonBin 'Horizon.exe')) { Ok "Horizon ($horizonBin)" } else { Bad "Horizon.exe" }

# --- server dependencies ---
if ($nodeOk -or (Have npm)) {
    Push-Location $ts
    $npmCmd = if (Test-Path 'package-lock.json') { 'ci' } else { 'install' }
    cmd /c "npm $npmCmd --no-fund --no-audit > npm-install.log 2>&1"   # npm warns on stderr; keep PowerShell out of it
    Pop-Location
    if (Test-Path (Join-Path $ts 'node_modules\.bin\tsx.cmd')) { Ok "server dependencies" } else { Bad "server npm install" }
}

# --- firewall ---
$tcp = 8080, 10060, 10071, 10073, 10075, 10077, 10078, 10079
$udp = 53, '50000-50099', 50100
if ($Firewall) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Bad "firewall rules need administrator rights: run PowerShell as administrator and .\Install-MSPR.ps1 -Firewall" }
    else {
        foreach ($p in $tcp) { if (-not (Get-NetFirewallRule -DisplayName "MSPR $p tcp" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "MSPR $p tcp" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null } }
        foreach ($p in $udp) { if (-not (Get-NetFirewallRule -DisplayName "MSPR $p udp" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "MSPR $p udp" -Direction Inbound -Protocol UDP -LocalPort $p -Action Allow | Out-Null } }
        Ok "firewall rules (TCP $($tcp -join ','); UDP $($udp -join ','))"
    }
} else { Info "Firewall: run as administrator .\Install-MSPR.ps1 -Firewall (TCP $($tcp -join ','); UDP $($udp -join ','))" }

Write-Host ""
if ($allOk) { Write-Host "Done. Start the server: scripts\START-MSPR.cmd (or scripts\Start-MSPRServer.ps1)" -ForegroundColor Cyan }
else { Write-Host "Fix the missing items and run again." -ForegroundColor Red; exit 1 }
