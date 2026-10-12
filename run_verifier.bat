@echo off
cd /d "%~dp0"
title Two-Stage Release Verifier

:menu
cls
echo ========================================================
echo   TWO-STAGE RELEASE VERIFIER - FLEET SUITE
echo ========================================================
echo.
echo [1] Run Automated Test Suite (Mock Releases)
echo [2] Verify a Saved Search JSON File
echo [3] Run Bandcamp Crawler with Verification (--verify)
echo [4] Run AMRAP Indie Crawler with Verification (--verify)
echo [5] Run Air Charts Crawler with Verification (--verify)
echo [6] Exit
echo.
echo ========================================================
set /p choice="Enter your choice (1-6): "

if "%choice%"=="1" (
    cls
    echo Running Verifier Test Suite...
    echo.
    node testVerifier.js
    echo.
    pause
    goto menu
)

if "%choice%"=="2" (
    cls
    echo ========================================================
    echo Verify Existing Saved Search File
    echo ========================================================
    echo.
    set /p jsonpath="Enter path to JSON (e.g. saved_searches\amrap_indie_discovery\amrap_indie_discovery_base.json): "
    echo.
    node src/index.js --verify "%jsonpath%"
    echo.
    pause
    goto menu
)

if "%choice%"=="3" (
    cls
    echo Running Bandcamp Crawler with Two-Stage Verification...
    echo.
    node src/index.js configs/bandcamp_indie.json --verify
    echo.
    pause
    goto menu
)

if "%choice%"=="4" (
    cls
    echo Running AMRAP Crawler with Two-Stage Verification...
    echo.
    node src/index.js configs/amrap_indie.json --verify
    echo.
    pause
    goto menu
)

if "%choice%"=="5" (
    cls
    echo Running Air Charts Crawler with Two-Stage Verification...
    echo.
    node src/index.js configs/air_charts.json --verify
    echo.
    pause
    goto menu
)

if "%choice%"=="6" (
    exit /b 0
)

goto menu
