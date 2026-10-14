param(
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$StartPath,
  [Parameter(Mandatory = $true)][string]$ReadyPath
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinVisible {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static bool Has(uint pid) {
    bool found = false;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint windowPid;
      GetWindowThreadProcessId(h, out windowPid);
      if (windowPid == pid && IsWindowVisible(h)) found = true;
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
Set-Content -LiteralPath $ReadyPath -Value 'ready' -Encoding ascii
$readyDeadline = (Get-Date).AddSeconds(30)
$parts = @()
while ($parts.Count -lt 3) {
  if ((Get-Date) -gt $readyDeadline) { exit 2 }
  if (Test-Path -LiteralPath $StartPath) { $parts = @(Get-Content -LiteralPath $StartPath) }
  Start-Sleep -Milliseconds 20
}
$origin = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$parts[0])
$parent = [int]$parts[1]
$mode = $parts[2].Trim()
$extractMs = $null
$windowMs = $null
$appPid = $null
$extractedPath = $null
$limit = $origin.AddMinutes(9)
while ([DateTimeOffset]::UtcNow -lt $limit) {
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'Multiclient.exe'")
  $matched = @()
  foreach ($row in $rows) {
    if ($mode -eq 'direct') {
      if ($row.ProcessId -eq $parent) { $matched += $row }
      continue
    }
    if ($row.ProcessId -eq $parent) { continue }
    $path = [string]$row.ExecutablePath
    if ($row.ParentProcessId -eq $parent -or ($path -and $path -like '*\Temp\*')) { $matched += $row }
  }
  if ($matched.Count -gt 0 -and $null -eq $extractMs -and $mode -eq 'portable') {
    $extractMs = [int]([DateTimeOffset]::UtcNow - $origin).TotalMilliseconds
    $extractedPath = [string]$matched[0].ExecutablePath
  }
  foreach ($row in $matched) {
    if ([WinVisible]::Has([uint32]$row.ProcessId)) {
      $windowMs = [int]([DateTimeOffset]::UtcNow - $origin).TotalMilliseconds
      $appPid = [int]$row.ProcessId
      if (-not $extractedPath) { $extractedPath = [string]$row.ExecutablePath }
      break
    }
  }
  if ($null -ne $windowMs) { break }
  $parentAlive = $null -ne (Get-Process -Id $parent -ErrorAction SilentlyContinue)
  if (-not $parentAlive -and $matched.Count -eq 0) { break }
  Start-Sleep -Milliseconds 50
}
@{
  extractMs     = $extractMs
  firstWindowMs = $windowMs
  appPid        = $appPid
  extractedPath = $extractedPath
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding ascii
