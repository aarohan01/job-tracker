$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = "C:\Users\ronha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Server = Join-Path $Root "app\server.mjs"
$PortFile = Join-Path $Root "server.port"

$Existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*job-tracker*" -and
    $_.CommandLine -like "*app*server.mjs*"
  }

if ($Existing) {
  if (Test-Path -LiteralPath $PortFile) {
    $Port = Get-Content -Raw -LiteralPath $PortFile
    Write-Output "Job Search tracker already running: http://localhost:$($Port.Trim())"
  } else {
    Write-Output "Job Search tracker already appears to be running. Existing process id(s): $($Existing.ProcessId -join ', ')"
  }
  exit 0
}

Start-Process -FilePath $Node -ArgumentList "`"$Server`"" -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $PortFile) {
  $Port = Get-Content -Raw -LiteralPath $PortFile
  Write-Output "Job Search tracker: http://localhost:$($Port.Trim())"
} else {
  Write-Output "Job Search tracker started. If the URL is not available yet, wait a few seconds and open http://localhost:3000"
}
