# setup_minipc_autostart.ps1
# Configures ONE permanent 24/7 background task on the Mini PC for the Fleet Command Center.
# Ensures the Node Scheduler runs continuously in the background across restarts.

if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to configure 24/7 auto-start..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Music Search Master - 24/7 Fleet Server Auto-Start Setup   " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$taskName = "MusicSearch_FleetCommandCenter_AutoStart"
$serverPath = Join-Path $PSScriptRoot "src\server.js"

# Locate Node.js executable
$nodeCmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-Not $nodeCmd) {
    Write-Host "Error: node.exe not found in PATH." -ForegroundColor Red
    exit 1
}
$nodePath = $nodeCmd.Source

# Remove old task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Configure single 24/7 daemon task
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverPath`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit 0

Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName $taskName -Description "Runs the Unified Fleet Command Center & In-Process Scheduler 24/7" -Force | Out-Null

Write-Host "[+] Registered 24/7 Background Task: $taskName" -ForegroundColor Green
Write-Host "    Node Path:        $nodePath" -ForegroundColor White
Write-Host "    Server Script:    $serverPath" -ForegroundColor White
Write-Host "    Execution Limit:  Indefinite (Runs 24/7)" -ForegroundColor White
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Success: Fleet Command Center will now run 24/7 on boot!   " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
