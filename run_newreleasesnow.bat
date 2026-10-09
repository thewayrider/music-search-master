@echo off
cd /d "%~dp0"

echo Running New Releases Now Crawler...
node src/index.js configs/newreleasesnow_indie.json

echo New Releases Now crawler finished!
