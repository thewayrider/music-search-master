# enable_legacy_music_tasks.ps1
# Rollback script: Re-enables the 15 music crawler tasks in Windows Task Scheduler.

if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to enable legacy music tasks..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Music Search Master - Rollback to Windows Task Scheduler   " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$musicTasks = @(
    "Futuremag AI Crawler",
    "LiveMusicSearchAgent",
    "LiveMusicSearchAgent_AirCharts",
    "LiveMusicSearchAgent_Amrap",
    "LiveMusicSearchAgent_Deezer",
    "LiveMusicSearchAgent_Futuremag",
    "LiveMusicSearchAgent_ListenBrainz",
    "LiveMusicSearchAgent_MusicBrainz",
    "LiveMusicSearchAgent_Nialler9",
    "LiveMusicSearchAgent_RootsMag",
    "MusicSearch_NewReleasesNow",
    "NewIndieLive24_Global",
    "NewIndieLive24_US",
    "Triple J Unearthed Crawler",
    "Triple J Weekly Reminder"
)

$enabledCount = 0

foreach ($taskName in $musicTasks) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Enable-ScheduledTask -TaskName $taskName | Out-Null
        Write-Host "[+] ENABLED: $taskName" -ForegroundColor Green
        $enabledCount++
    }
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Rollback Complete: $enabledCount tasks re-enabled in Windows." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
