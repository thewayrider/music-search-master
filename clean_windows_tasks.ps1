# clean_windows_tasks.ps1
# Unregisters legacy Windows Task Scheduler jobs for music-search-master
# Run this once on your Mini PC or Desktop when migrating to the In-Process Node Scheduler.

if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to clean Task Scheduler..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Music Search Master - Legacy Task Scheduler Cleanup        " -ForegroundColor Cyan
Write-Host " Migrating to In-Process Node Scheduler (src/server.js)     " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$tasksToRemove = @(
    "NewIndieLive24_Global",
    "NewIndieLive24_US",
    "LiveMusicSearchAgent",
    "LiveMusicSearchAgent_ListenBrainz",
    "LiveMusicSearchAgent_AirCharts",
    "LiveMusicSearchAgent_Amrap",
    "Triple J Unearthed Crawler",
    "LiveMusicSearchAgent_Futuremag",
    "LiveMusicSearchAgent_RootsMag",
    "LiveMusicSearchAgent_MusicBrainz",
    "LiveMusicSearchAgent_Deezer",
    "LiveMusicSearchAgent_Nialler9",
    "LiveMusicSearchAgent_NewReleasesNow",
    "MusicSearch_NewReleasesNow",
    "LiveMusicSearchAgent_AcidStag",
    "Triple J API Crawler",
    "Triple J Weekly Reminder"
)

$removedCount = 0

foreach ($taskName in $tasksToRemove) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[-] Removed legacy task: $taskName" -ForegroundColor Yellow
        $removedCount++
    } else {
        Write-Host "    Task not found (already clean): $taskName" -ForegroundColor DarkGray
    }
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Cleanup Complete: $removedCount legacy Windows tasks unregistered." -ForegroundColor Green
Write-Host " All schedules are now handled in-process by src/server.js! " -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
