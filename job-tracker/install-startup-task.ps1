$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $Root "start-job-tracker.ps1"
$ShortcutName = "Job Search Tracker.lnk"

if (-not (Test-Path -LiteralPath $StartScript)) {
  throw "Could not find start script: $StartScript"
}

$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder $ShortcutName
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Start the local Job Tracker dashboard when this user logs in."
$Shortcut.Save()

Write-Output "Installed startup shortcut '$ShortcutPath'. It will run at your next Windows logon."
