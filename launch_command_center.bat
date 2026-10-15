@echo off
title Unified Fleet Command Center
cd /d "%~dp0"
echo ========================================================
echo  🛰️  LAUNCHING UNIFIED FLEET COMMAND CENTER
echo ========================================================

:: 1. Check if Fleet Server is already running on port 4000
curl.exe -s http://localhost:4000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [✓] Fleet Server is already running on port 4000.
    goto launch_ui
)

:: 2. If not running, start server in a persistent minimized background process
echo [1/2] Starting Fleet Server Daemon on port 4000...
start "Fleet Server Daemon" /min cmd.exe /k "node src/server.js"

echo [2/2] Waiting for server initialization...
timeout /t 3 /nobreak >nul

:launch_ui
echo [3/3] Opening Dedicated App Window (Extensions Disabled)...
start "" msedge --app=http://localhost:4000 --window-size=1300,880 --disable-extensions 2>nul || start http://localhost:4000

echo ========================================================
echo  Command Center is operational.
echo  Local URL:  http://localhost:4000
echo  LAN/Bridge: http://localhost:4000/api/fleet/status
echo ========================================================
