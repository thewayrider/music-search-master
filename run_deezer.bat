@echo off
cd /d "%~dp0"
echo Running Deezer Crawler...
node src/index.js configs/deezer_indie.json
