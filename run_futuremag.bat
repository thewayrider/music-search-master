@echo off
cd /d "%~dp0"

echo Running Futuremag Crawler...
node src/index.js configs/futuremag_indie.json

echo Futuremag crawler finished!
