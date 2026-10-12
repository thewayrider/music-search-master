# disable_legacy_music_tasks.ps1
# Safely DISABLES the 15 music crawler tasks in Windows Task Scheduler.
# Leaves Plex, Git updater, and system tasks 100% untouched.
# You can re-enable anytime using enable_legacy_music_tasks.ps1.

if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to disable legacy music tasks..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Music Search Master - Safe Handover to Node Scheduler      " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# The EXACT 15 music crawler tasks from your Mini PC Task Scheduler:
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

$disabledCount = 0

foreach ($taskName in $musicTasks) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Write-Host "[-] DISABLED: $taskName" -ForegroundColor Yellow
        $disabledCount++
    } else {
        Write-Host "    Not found (already clean): $taskName" -ForegroundColor DarkGray
    }
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Handover Ready: $disabledCount music tasks have been DISABLED." -ForegroundColor Green
Write-Host " Important: Plex, Git updater, and system tasks were NOT touched." -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
