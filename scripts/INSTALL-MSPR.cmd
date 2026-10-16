@echo off
rem Checks/installs .NET 6, Node.js, Horizon and the server dependencies.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-MSPR.ps1" %*
pause
