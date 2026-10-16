# Start-MSPRServer.ps1 - starts the whole MotorStorm: Pacific Rift server stack
#
#   server   (Node/TypeScript)  DNS :53, SVO :10060, status page + JSON API :8080, SQLite database
#                                settings: server\config\ (mspr.json, eula.txt, announcement.txt)
#   Horizon   (C#)               MUIS :10071, MAS :10075, MPS :10077, MLS :10078, MMS :10079,
#                                DME :10073 + UDP 50000-50099 (one per player), BWPS UDP 50100
#
# Usage:
#   .\Start-MSPRServer.ps1                      # LAN server
#   .\Start-MSPRServer.ps1 -UseLocalRPCS3       # + point this PC's RPCS3 (MSPR custom config) DNS here
#   .\Start-MSPRServer.ps1 -PublicIp auto       # internet server (public IP looked up automatically)
#   .\Start-MSPRServer.ps1 -PublicIp 1.2.3.4    # internet server with a fixed IP
#   .\Start-MSPRServer.ps1 -TestMode            # tests only: accept expired (genuine) NP tickets
#   .\Start-MSPRServer.ps1 -TestMinPlayers 2    # experimental: minimum players of matchmade games
#   .\Start-MSPRServer.ps1 -LogLevel full       # log level quiet|normal|full (default normal)
#   .\Start-MSPRServer.ps1 -NoDashboard         # do not open the MSPR Status console window
#   .\Stop-MSPRServer.ps1 [-RestoreDns]

param(
    [switch]$UseLocalRPCS3,
    [switch]$TestMode,
    [string]$PublicIp = '',
    [string]$RPCS3Config = '',
    [int]$TestMinPlayers = 0,
    [ValidateSet('quiet', 'normal', 'full')][string]$LogLevel = 'normal',
    [switch]$NoDashboard,
    [int]$KeepLogs = 20
)

$ErrorActionPreference = 'Stop'
$scripts = Split-Path -Parent $MyInvocation.MyCommand.Path        # ...\scripts
$repo    = Split-Path -Parent $scripts                             # repository root
$horizon = Join-Path $repo 'horizon\Servers\Horizon\bin\Release\net10.0'
$ts      = Join-Path $repo 'server'
$logs    = Join-Path $repo 'logs'

function Get-LanIp {
    $s = New-Object Net.Sockets.UdpClient
    try { $s.Connect('1.1.1.1', 80); $s.Client.LocalEndPoint.Address.ToString() } finally { $s.Close() }
}
function Test-Port($port, $udp = $false) {
    if ($udp) { [bool](Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue) }
    else { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
}
function Set-JsonFile($path, [scriptblock]$edit) {
    $obj = Get-Content $path -Raw | ConvertFrom-Json
    & $edit $obj
    $obj | ConvertTo-Json -Depth 20 | Set-Content $path -Encoding UTF8
}
# MotorStorm: Pacific Rift discs: BCUS98155 (US), BCES00129 (EU). Both use Medius app id 21624.
$GameSerials = @('BCUS98155', 'BCES00129')
function Find-RPCS3Configs {
    if ($RPCS3Config) { return @($RPCS3Config) }
    return @(foreach ($serial in $GameSerials) {
        Get-ChildItem "$env:USERPROFILE\Documents\RPCS3", "$env:USERPROFILE\Desktop", "$env:APPDATA\rpcs3", 'C:\RPCS3' -Recurse -Depth 4 `
            -Filter "config_$serial.yml" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    })
}

if (-not (Test-Path (Join-Path $horizon 'Horizon.exe'))) {
    Write-Host "Horizon is not built. Run scripts\Install-MSPR.ps1 first." -ForegroundColor Red
    exit 1
}

$lan = Get-LanIp
$advertised = $lan
if ($PublicIp) {
    if ($PublicIp -eq 'auto') {
        try { $PublicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5).Trim() }
        catch { Write-Host "Could not look up the public IP, give it by hand: -PublicIp x.x.x.x" -ForegroundColor Red; exit 1 }
    }
    $advertised = $PublicIp
}
Write-Host "=== MSPR server stack (LAN $lan, advertised to players $advertised) ===" -ForegroundColor Cyan

foreach ($p in 10060, 10071, 10075, 10078, 8080) {
    if (Test-Port $p) {
        $owner = (Get-NetTCPConnection -LocalPort $p -State Listen | Select-Object -First 1).OwningProcess
        Write-Host "Port $p is already in use (PID $owner, $((Get-Process -Id $owner).Name)). Run Stop-MSPRServer.ps1 first." -ForegroundColor Red
        exit 1
    }
}

# --- Horizon stores absolute config paths (horizon.json, medius.json): always point them at this folder,
#     otherwise a moved/unzipped package would read (and create) its configs in the old location ---
$staticJson = ((Resolve-Path $horizon).Path + '\static').Replace('\', '\\')
foreach ($f in 'horizon.json', 'medius.json') {
    $path = Join-Path $horizon "static\$f"
    $raw = Get-Content $path -Raw
    $fixed = [regex]::Replace($raw, '"[^"]*?net(?:6|10)\.0(?:\\\\|/)static', '"' + $staticJson)
    if ($fixed -ne $raw) { Set-Content $path $fixed -Encoding UTF8 -NoNewline }
}

# --- Horizon configs: listen on the LAN IP, advertise $advertised to players ---
$usePublic = [bool]$PublicIp
# SVO host (server\config\mspr.json -> svo.host). 'auto' = IP: the game's SVO client then skips its
# one-slot DNS resolver (one unanswered lookup blocks SVO until the game restarts). A name also works (our DNS answers it).
$svoHost = (Get-Content (Join-Path $ts 'config\mspr.json') -Raw | ConvertFrom-Json).svo.host
if (-not $svoHost -or $svoHost -eq 'auto') { $svoHost = $advertised }
Set-JsonFile (Join-Path $horizon 'static\muis.json') {
    param($m)
    $m.MUISIp = $lan; $m.NATIp = $advertised; $m.UsePublicIp = $usePublic; $m.PublicIpOverride = $(if ($usePublic) { $advertised } else { '' })
    foreach ($u in $m.Universes.'21624') {
        $u.Endpoint = $advertised; $u.SvoURL = "http://${svoHost}:10060/motorstormpr/index?languageID=1"
        $u.UserCount = 0; $u.MaxUsers = 1000
    }
}
Set-JsonFile (Join-Path $horizon 'static\medius.json') {
    param($m)
    $m.MEDIUSIp = $lan; $m.MUCGServerIP = $lan; $m.MUMIp = $lan; $m.NATIp = $advertised; $m.BillingProviderIpAddr = $lan
    $m.UsePublicIp = $usePublic; $m.PublicIpOverride = $(if ($usePublic) { $advertised } else { '' })
}
# --- MotorStorm: Pacific Rift only: Horizon's default config starts services for dozens of games
#     (43 DME applications, 59 MUIS universes, 3 MUIS ports) -> ~1800 threads and ~900 MB of memory ---
Set-JsonFile (Join-Path $horizon 'static\muis.json') {
    param($m)
    $m.Ports = @(10071)
    $m.CompatibleApplicationIds = @(21624)
    $keep = [ordered]@{}; $keep['21624'] = $m.Universes.'21624'
    $m.Universes = [pscustomobject]$keep
}
Set-JsonFile (Join-Path $horizon 'static\horizon.json') {
    param($m)
    if ($m.prometheus) { $m.prometheus.enabled = $false }   # metrics endpoint :1234 not used
}

Set-JsonFile (Join-Path $horizon 'static\dme.json') {
    param($m)
    $m.ApplicationIds = @(21624)
    $m.DMEIp = $lan; $m.UsePublicIp = $usePublic; $m.PublicIpOverride = $(if ($usePublic) { $advertised } else { '' })
    if ($m.MAS) { $m.MAS.Ip = $lan }; if ($m.MPS) { $m.MPS.Ip = $lan }
}

New-Item -ItemType Directory -Force $logs | Out-Null

# --- Logs: move the previous run's logs to the archive (Horizon overwrites Horizon.log on every start) ---
function Save-Log($file, $archiveDir, $prefix) {
    if (-not (Test-Path $file) -or (Get-Item $file).Length -eq 0) { return }
    New-Item -ItemType Directory -Force $archiveDir | Out-Null
    $stamp = (Get-Item $file).LastWriteTime.ToString('yyyy-MM-dd_HH-mm-ss')
    Move-Item $file (Join-Path $archiveDir "$prefix-$stamp.log") -Force
    Get-ChildItem $archiveDir -Filter "$prefix-*.log" | Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepLogs | Remove-Item -Force
}
Save-Log (Join-Path $horizon 'logs\Horizon.log') (Join-Path $horizon 'logs\archive') 'Horizon'
Save-Log (Join-Path $logs 'server.log') (Join-Path $logs 'archive') 'server'

# --- 1. server: DNS + SVO + status page + database ---
$tsx = Join-Path $ts 'node_modules\.bin\tsx.cmd'
if (-not (Test-Path $tsx)) {
    Write-Host "Installing server dependencies (npm install)..." -ForegroundColor Yellow
    Push-Location $ts; cmd /c "npm install --no-fund --no-audit > npm-install.log 2>&1"; Pop-Location
}
# cmd: "/c set X=..&& "tsx.cmd" src\index.ts > "log" 2>&1" (first char is not a quote -> cmd keeps the quoting)
$envSet = if ($usePublic) { "set MSPR_PUBLIC_IP=$advertised&& " } else { "set MSPR_PUBLIC_IP=&& " }
Start-Process cmd.exe -WorkingDirectory $ts -WindowStyle Minimized `
    -ArgumentList "/c $envSet`"$tsx`" src\index.ts > `"$logs\server.log`" 2>&1"

# --- 2. Horizon (Medius + DME) ---
$env:MSPR_MM_MIN_PLAYERS = $(if ($TestMinPlayers -gt 0) { "$TestMinPlayers" } else { '' })
$env:HORIZON_LOG_LEVEL = $LogLevel
$hzArgs = if ($TestMode) { '/c "{0}" test' -f "$scripts\run_horizon.cmd" } else { '/c "{0}"' -f "$scripts\run_horizon.cmd" }
Start-Process cmd.exe -ArgumentList $hzArgs -WindowStyle Minimized

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and -not ((Test-Port 10071) -and (Test-Port 10078) -and (Test-Port 10060) -and (Test-Port 8080))) { Start-Sleep 1 }

$ok = $true
foreach ($c in @(@{n = 'DNS     :53   '; t = (Test-Port 53 $true) }, @{n = 'SVO     :10060'; t = (Test-Port 10060) },
                 @{n = 'MUIS    :10071'; t = (Test-Port 10071) }, @{n = 'MAS     :10075'; t = (Test-Port 10075) },
                 @{n = 'MLS     :10078'; t = (Test-Port 10078) }, @{n = 'Web     :8080 '; t = (Test-Port 8080) })) {
    if ($c.t) { Write-Host "[OK]   $($c.n)" -ForegroundColor Green } else { Write-Host "[FAIL] $($c.n)" -ForegroundColor Red; $ok = $false }
}

if ($UseLocalRPCS3) {
    $cfgPaths = @(Find-RPCS3Configs | Where-Object { $_ -and (Test-Path $_) })
    foreach ($cfgPath in $cfgPaths) {
        if (-not (Test-Path "$cfgPath.original.bak")) { Copy-Item $cfgPath "$cfgPath.original.bak" }
        (Get-Content $cfgPath -Raw) -replace '(?m)^(\s*DNS address:).*$', "`$1 $lan" | Set-Content $cfgPath -Encoding UTF8
        Write-Host "[OK]   RPCS3 $([IO.Path]::GetFileNameWithoutExtension($cfgPath) -replace '^config_') DNS -> $lan ($cfgPath)" -ForegroundColor Green
        if ($cfgPath -notmatch 'BCUS98155') { continue }   # the Custom Game patch is for the US 1.03 EBOOT only
        # game fix as an RPCS3 patch (Custom Game map after Ranked/Casual): install once, enable in Manage Game Patches
        $rpcs3Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $cfgPath))
        $patchDst = Join-Path $rpcs3Root 'patches\imported_patch.yml'
        $patchSrc = Join-Path $repo 'patches\rpcs3\imported_patch.yml'
        if ((Test-Path $patchSrc) -and (Test-Path (Join-Path $rpcs3Root 'patches'))) {
            if (-not (Test-Path $patchDst)) { Copy-Item $patchSrc $patchDst; Write-Host "[OK]   RPCS3 patch installed: $patchDst (enable it in Manage Game Patches)" -ForegroundColor Green }
            elseif (-not (Select-String -Path $patchDst -Pattern 'Keep Custom Game settings' -Quiet)) { Write-Host "RPCS3 already has its own imported_patch.yml: import patches\rpcs3\imported_patch.yml with the Patch Manager's Import button" -ForegroundColor Yellow }
        }
    }
    if (-not $cfgPaths) { Write-Host "RPCS3's MSPR config (config_BCUS98155.yml / config_BCES00129.yml) was not found. Give the path: -RPCS3Config <path>" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "RPCS3: Configuration -> Network -> DNS address = $(if ($usePublic) { "$advertised (friends) / $lan (this PC)" } else { $lan })" -ForegroundColor Yellow
Write-Host "Status page: http://${lan}:8080/   Logs: logs\server.log, $horizon\logs\Horizon.log"
if ($ok -and -not $NoDashboard) {
    # MSPR Status console: resources, players, games, matchmaking and latest errors in real time
    Start-Process cmd.exe -WorkingDirectory $ts -ArgumentList "/c title MSPR Status && `"$tsx`" src\dashboard.ts"
}
Write-Host "Log level $LogLevel; earlier runs: $horizon\logs\archive and $logs\archive"
if (-not $ok) { exit 1 }
