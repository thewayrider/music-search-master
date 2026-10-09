@echo off
cd /d "%~dp0"
echo ========================================================
echo   MUSIC SEARCH MASTER - MISSION CONTROL
echo ========================================================
echo Initializing fleet metrics and cloud telemetry...

:: Update metrics and sync to GitHub Gist for Android App
node -e "try { const { aggregateCrawlerMetrics } = require('./src/utils/metricsAggregator'); const { syncMetricsToGist } = require('./src/utils/gistSync'); const { generateDashboard } = require('./src/utils/dashboardGenerator'); generateDashboard(); const m = aggregateCrawlerMetrics(); syncMetricsToGist(m).then(() => console.log('[Telemetry] Synchronized with GitHub Gist for Android Monitor.')).catch(e => console.warn(e.message)); } catch(e) { console.warn(e.message); }"

:: Launch Edge App mode without Norton/extensions interference, falling back to default browser
echo Opening Mission Control in browser...
start "" "msedge.exe" --app="http://localhost:4000" --disable-extensions 2>nul || start http://localhost:4000

echo Starting Unified Fleet Server on Port 4000...
node src/server.js
pause
