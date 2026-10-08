@echo off
cd /d "%~dp0"

echo Running AMRAP Crawler...
node src/index.js configs/amrap_indie.json

echo AMRAP crawler finished!
