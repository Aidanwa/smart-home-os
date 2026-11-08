# Pulls nightly smart-home-os backup bundles from the Pi to the folder this script lives in.
# Run by the Task Scheduler task "SmartHome Backup Pull" (at logon + daily 9:00, catches up if missed).
# Read-only on the Pi: it only lists and copies files from ~/backups there.
# Keeps 30 days of bundles here (the Pi itself keeps 14).

$ErrorActionPreference = "Continue"
$dir      = $PSScriptRoot      # keep this script in the backup folder
$log      = Join-Path $dir "pull.log"
$remote   = "smarthome-pi"     # SSH alias in ~/.ssh/config (HostName + User of the Pi)
$keepDays = 30
$ssh      = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp      = "$env:WINDIR\System32\OpenSSH\scp.exe"
$opts     = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")

function Log($msg) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" }

# 1. List bundles on the Pi
$files = & $ssh @opts $remote "ls ~/backups"
if ($LASTEXITCODE -ne 0) { Log "Pi unreachable (ssh exit $LASTEXITCODE), skipped"; exit 1 }

# 2. Copy any we don't have yet
$pulled = 0; $failed = 0
foreach ($f in $files | Where-Object { $_ -match '^smarthome-\d{4}-\d{2}-\d{2}\.tar\.gz$' }) {
    $dest = Join-Path $dir $f
    if (Test-Path $dest) { continue }
    & $scp @opts -q "${remote}:~/backups/$f" "$dest.part"
    if ($LASTEXITCODE -eq 0) {
        Move-Item -Force "$dest.part" $dest
        Log "pulled $f"; $pulled++
    } else {
        Remove-Item -ErrorAction SilentlyContinue "$dest.part"
        Log "ERROR: failed to copy $f (scp exit $LASTEXITCODE)"; $failed++
    }
}

# 3. Retention, by the date in the filename (scp resets file timestamps)
$cutoff = (Get-Date).Date.AddDays(-$keepDays)
Get-ChildItem $dir -Filter "smarthome-*.tar.gz" | ForEach-Object {
    if ($_.Name -match 'smarthome-(\d{4}-\d{2}-\d{2})\.tar\.gz') {
        if ([datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null) -lt $cutoff) {
            Remove-Item $_.FullName; Log "deleted old $($_.Name)"
        }
    }
}

$total = (Get-ChildItem $dir -Filter "smarthome-*.tar.gz").Count
Log "done: $pulled pulled, $failed failed, $total bundles on PC"
if ($failed -gt 0) { exit 1 }
