@echo off
cd /d "%~dp0"

echo Running Nialler9 Crawler...
node src/index.js configs/nialler9_indie.json

echo Nialler9 crawler finished!
