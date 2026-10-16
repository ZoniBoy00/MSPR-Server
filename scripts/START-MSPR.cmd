@echo off
rem Starts the MSPR server (DNS, SVO, status page, Horizon) and points this PC's RPCS3 to it.
rem Internet server: START-MSPR.cmd -PublicIp auto
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-MSPRServer.ps1" -UseLocalRPCS3 %*
echo.
echo Status page: http://localhost:8080/
pause
