# Pull hourly backup archives from the lottery server, keep 30 days locally.
# Scheduled task: daily 21:30 (installer: tools/install-backup-task.ps1)
$key = 'C:\Users\11818\.ssh\jiaowu_deploy'
$server = 'root@47.104.166.226'
$remoteDir = '/srv/lottery-backups'
$dest = 'E:\lottery-backups'
$logDir = Join-Path $dest '_logs'
$keepDays = 30

New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('pull-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))

function Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Output $line
}

$list = @()
$rawList = & ssh -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new $server "ls -1 $remoteDir"
foreach ($line in @($rawList)) {
  $leaf = (([string]$line) -replace "`r", '').Trim()
  if ($leaf -match '^lottery-[0-9]{8}-[0-9]{4}\.tar\.gz$') { $list += $leaf }
}

if ($list.Count -eq 0) {
  Log ('remote listing empty (ssh exit ' + $LASTEXITCODE + ', lines ' + @($rawList).Count + ')')
  exit 0
}

$pulled = 0
foreach ($name in $list) {
  $target = Join-Path $dest $name
  if (Test-Path $target) { continue }
  & scp -i $key -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${server}:$remoteDir/$name" $target
  if (Test-Path $target) {
    $pulled++
    Log ('pulled ' + $name)
  } else {
    Log ('FAILED ' + $name)
  }
}

$cut = (Get-Date).AddDays(-$keepDays)
$old = @(Get-ChildItem $dest -Filter 'lottery-*.tar.gz' | Where-Object { $_.LastWriteTime -lt $cut })
foreach ($f in $old) { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
if ($old.Count -gt 0) { Log ('pruned ' + $old.Count + ' files older than ' + $keepDays + ' days') }

$all = @(Get-ChildItem $dest -Filter 'lottery-*.tar.gz')
$mb = 0
if ($all.Count -gt 0) { $mb = [math]::Round((($all | Measure-Object Length -Sum).Sum / 1MB), 1) }
Log ('done: new=' + $pulled + ' total=' + $all.Count + ' sizeMB=' + $mb)
