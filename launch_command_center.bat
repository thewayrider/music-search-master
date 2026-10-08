@echo off
title Unified Fleet Command Center
echo ========================================================
echo  🛰️  LAUNCHING UNIFIED FLEET COMMAND CENTER
echo ========================================================
cd /d "%~dp0"

echo [1/2] Starting Fleet Server on port 4000...
start /b "" node src/server.js

echo [2/2] Waiting for server initialization...
timeout /t 2 /nobreak >nul

echo [3/3] Opening Dedicated App Window (Extensions Disabled)...
start msedge --app=http://localhost:4000 --window-size=1300,880 --disable-extensions 2>nul || start http://localhost:4000

echo ========================================================
echo  Command Center is running.
echo  Local URL:  http://localhost:4000
echo  LAN/Bridge: http://localhost:4000/api/fleet/status
echo ========================================================
