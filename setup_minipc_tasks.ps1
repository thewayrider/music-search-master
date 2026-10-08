# setup_minipc_tasks.ps1
# Configures all Windows Task Scheduler jobs on the Mini PC for music-search-master

# Self-elevate to Administrator to ensure Register-ScheduledTask permissions
if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to configure Task Scheduler..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Music Search Master - Mini PC Task Scheduler Configuration " -ForegroundColor Cyan
Write-Host " Base Directory: $PSScriptRoot" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# 1. Clean up obsolete legacy tasks if present
$obsoleteTasks = @(
    "LiveMusicSearchAgent_AcidStag",
    "Triple J API Crawler"
)
foreach ($legacyName in $obsoleteTasks) {
    if (Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $legacyName -Confirm:$false
        Write-Host "[-] Removed obsolete legacy task: $legacyName" -ForegroundColor DarkGray
    }
}

# 2. Daily Radars
$dailyRadars = @(
    @{
        Name = "NewIndieLive24_Global";
        Description = "New Indie Live 24 - Global Daily Radar (06:30 AM)";
        Script = "run_daily_radar.bat";
        Time = "06:30AM"
    },
    @{
        Name = "NewIndieLive24_US";
        Description = "New Indie Live 24 - US Edition Daily Radar (07:00 AM)";
        Script = "run_us_radar.bat";
        Time = "07:00AM"
    }
)

Write-Host "`nRegistering Daily Radars..." -ForegroundColor Green
foreach ($radar in $dailyRadars) {
    $taskName = $radar.Name
    $batPath = Join-Path $PSScriptRoot $radar.Script
    
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $PSScriptRoot
    $trigger = New-ScheduledTaskTrigger -Daily -At $radar.Time
    
    Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName $taskName -Description $radar.Description -Force | Out-Null
    Write-Host "[+] Registered Daily Radar: $taskName ($($radar.Time)) -> $($radar.Script)" -ForegroundColor White
}

# 3. Weekly Crawlers from configs/schedules.json
$jsonPath = Join-Path $PSScriptRoot "configs\schedules.json"
if (-Not (Test-Path $jsonPath)) {
    Write-Host "Error: schedules.json not found at $jsonPath" -ForegroundColor Red
    exit 1
}

$schedules = Get-Content $jsonPath | ConvertFrom-Json

Write-Host "`nRegistering Weekly Crawlers from schedules.json..." -ForegroundColor Green
foreach ($task in $schedules) {
    $taskName = $task.name
    $batPath = Join-Path $PSScriptRoot $task.script
    
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $PSScriptRoot
    $days = $task.days
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $task.time
    
    Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName $taskName -Description $task.description -Force | Out-Null
    Write-Host "[+] Registered Crawler: $taskName ($($task.days -join ', ') at $($task.time))" -ForegroundColor White
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " All 13 Fleet Tasks Successfully Configured on Mini PC!     " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
