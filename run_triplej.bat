@echo off
cd /d "%~dp0"

echo Running Triple J ABC Reminder...
node src/sendTripleJReminder.js

echo Triple J reminder finished!
