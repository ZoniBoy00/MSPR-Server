@echo off
rem Stops the MSPR server and points RPCS3 back to the original service.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-MSPRServer.ps1" -RestoreDns %*
pause
