@echo off
cd /d "%~dp0"

echo Running Roots Mag Crawler...
node src/index.js configs/rootsmag_indie.json

echo Roots Mag crawler finished!
