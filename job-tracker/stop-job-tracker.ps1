$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PortFile = Join-Path $Root "server.port"
$PidFile = Join-Path $Root "server.pid"

$Processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*job-tracker*" -and
    $_.CommandLine -like "*app*server.mjs*"
  }

if (-not $Processes) {
  Write-Output "No Job Search tracker server process found."
} else {
  foreach ($Process in $Processes) {
    Stop-Process -Id $Process.ProcessId -Force
    Write-Output "Stopped Job Search tracker process $($Process.ProcessId)."
  }
}

if (Test-Path -LiteralPath $PortFile) {
  Remove-Item -LiteralPath $PortFile -Force
}

if (Test-Path -LiteralPath $PidFile) {
  Remove-Item -LiteralPath $PidFile -Force
}
