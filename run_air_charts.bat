@echo off
cd /d "%~dp0"

echo Running AIR Charts Crawler...
node src/index.js configs/air_charts.json

echo AIR Charts crawler finished!
