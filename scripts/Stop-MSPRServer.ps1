# Stop-MSPRServer.ps1 - stops the MSPR stack (server: DNS/SVO/web, Horizon, MSPR Status console)
#   -RestoreDns   points RPCS3's MSPR config DNS back to the original service (67.222.156.250)

param([switch]$RestoreDns, [string]$RPCS3Config = '')

Get-Process Horizon -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name like 'node%'" |
    Where-Object { $_.CommandLine -match 'src.index\.ts|src.dashboard\.ts' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "MSPR stack stopped." -ForegroundColor Green

if ($RestoreDns) {
    $cfgs = @(if ($RPCS3Config) { $RPCS3Config } else {
        foreach ($serial in 'BCUS98155', 'BCES00129') {   # US and EU discs
            Get-ChildItem "$env:USERPROFILE\Documents\RPCS3", "$env:USERPROFILE\Desktop", "$env:APPDATA\rpcs3", 'C:\RPCS3' -Recurse -Depth 4 `
                -Filter "config_$serial.yml" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        } }) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($cfg in $cfgs) {
        (Get-Content $cfg -Raw) -replace '(?m)^(\s*DNS address:).*$', '$1 67.222.156.250' | Set-Content $cfg -Encoding UTF8
        Write-Host "RPCS3 $([IO.Path]::GetFileNameWithoutExtension($cfg) -replace '^config_') DNS -> 67.222.156.250 (the original service)" -ForegroundColor Green
    }
    if (-not $cfgs) { Write-Host "RPCS3's MSPR config was not found (-RPCS3Config <path>)." -ForegroundColor Yellow }
}
