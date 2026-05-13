$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = "C:\Users\ronha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Server = Join-Path $Root "app\server.mjs"
$PortFile = Join-Path $Root "server.port"
$PidFile = Join-Path $Root "server.pid"

$Processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*job-tracker*" -and
    $_.CommandLine -like "*app*server.mjs*"
  }

foreach ($Process in $Processes) {
  Stop-Process -Id $Process.ProcessId -Force
  Write-Output "Stopped existing Job Search tracker process $($Process.ProcessId)."
}

if (Test-Path -LiteralPath $PortFile) {
  Remove-Item -LiteralPath $PortFile -Force
}

if (Test-Path -LiteralPath $PidFile) {
  Remove-Item -LiteralPath $PidFile -Force
}

$PortOwners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($PortOwners) {
  foreach ($OwnerPid in $PortOwners) {
    $Owner = Get-CimInstance Win32_Process -Filter "ProcessId = $OwnerPid"
    Write-Output "Port 3000 is currently used by process ${OwnerPid}:"
    Write-Output "  $($Owner.CommandLine)"
  }

  $Answer = Read-Host "Stop the process using port 3000 and continue? Type YES to stop it"
  if ($Answer -ne "YES") {
    throw "Port 3000 is still in use. Restart cancelled."
  }

  foreach ($OwnerPid in $PortOwners) {
    Stop-Process -Id $OwnerPid -Force
    Write-Output "Stopped process $OwnerPid that was using port 3000."
  }
  Start-Sleep -Seconds 1
}

$env:PORT = "3000"
$env:STRICT_PORT = "1"
Start-Process -FilePath $Node -ArgumentList "`"$Server`"" -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $PortFile) {
  $Port = (Get-Content -Raw -LiteralPath $PortFile).Trim()
  if ($Port -eq "3000") {
    Write-Output "Job Search tracker running at http://localhost:3000"
  } else {
    throw "Expected port 3000, but tracker reported port $Port."
  }
} else {
  throw "Tracker did not start. Port 3000 may still be in use by another program."
}
