@echo off
cd /d "%~dp0"

echo Running Triple J Unearthed Crawler...
node src/index.js configs/triplej_unearthed_indie.json

echo Triple J Unearthed crawler finished!
