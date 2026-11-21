# Install the daily backup-pull scheduled task (Windows, per current user).
# Creates a small .cmd wrapper first so the task path has no spaces/CJK.
$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'pull-backups.ps1'
if (-not (Test-Path $script)) { throw "pull-backups.ps1 not found next to installer" }

$wrapper = Join-Path $env:USERPROFILE 'lottery-pull-backups.cmd'
$content = "@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$script`" >> `"E:\lottery-backups\_logs\schtask.log`" 2>&1`r`n"
[System.IO.File]::WriteAllText($wrapper, $content, (New-Object System.Text.UTF8Encoding($false)))

& schtasks /Create /TN 'LotteryBackupPull' /TR "`"$wrapper`"" /SC DAILY /ST 21:30 /F

Write-Output ('wrapper : ' + $wrapper)
Write-Output ('script  : ' + $script)
Write-Output 'task    : LotteryBackupPull, daily 21:30'
Write-Output 'test now: schtasks /Run /TN "LotteryBackupPull"'
