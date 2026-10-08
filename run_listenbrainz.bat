@echo off
cd /d "%~dp0"

echo Running ListenBrainz Crawler...
node src/index.js configs/listenbrainz_indie.json

echo ListenBrainz crawler finished!
