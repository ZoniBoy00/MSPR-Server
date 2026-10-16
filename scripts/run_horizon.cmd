@echo off
rem Runs Horizon (Medius MUIS/MAS/MLS/MPS/MMS + DME) for MotorStorm: Pacific Rift.
rem   run_horizon.cmd          normal mode
rem   run_horizon.cmd test     test mode: also accept expired-but-genuine NP tickets
rem Log detail: HORIZON_LOG_LEVEL=quiet|normal|full (Start-MSPRServer.ps1 -LogLevel, default normal)
if not defined HORIZON_LOG_LEVEL set HORIZON_LOG_LEVEL=normal
if not defined HORIZON_IO_THREADS set HORIZON_IO_THREADS=4
set HORIZON_XI5_IGNORE_EXPIRY=0
if /i "%~1"=="test" set HORIZON_XI5_IGNORE_EXPIRY=1
rem test mode also trusts the test key of tools\medius\make_test_ticket.mjs (the end-to-end check signs its ticket with it)
if /i "%~1"=="test" set HORIZON_XI5_TEST_PUBKEY=%~dp0..\tools\medius\test_rpcn_public.pem
cd /d "%~dp0..\horizon\Servers\Horizon\bin\Release\net10.0"
title MSPR Horizon (log %HORIZON_LOG_LEVEL%)
"%CD%\Horizon.exe"
