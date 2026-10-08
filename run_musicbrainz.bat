@echo off
cd /d "%~dp0"

echo ========================================================
echo Starting MusicBrainz Agent Crawler
echo ========================================================
node src/index.js configs/musicbrainz_indie.json
echo ========================================================
echo MusicBrainz crawler finished!
echo ========================================================
