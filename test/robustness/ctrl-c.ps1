# Windows half of interrupt.ts: starts ng-matrix in a console of its own, waits until its log shows
# the step to interrupt, presses Ctrl+Break in that console, and prints the exit code. (A process
# started in its own process group has Ctrl+C disabled by Windows; Ctrl+Break reaches the same handler.)
param(
  [Parameter(Mandatory)] [string] $Node,
  [Parameter(Mandatory)] [string] $Cli,
  [Parameter(Mandatory)] [string] $Cwd,
  [Parameter(Mandatory)] [string] $Step,
  [Parameter(Mandatory)] [string] $Log
)
Add-Type -Namespace W -Name K -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr h, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);
'@
$process = Start-Process -FilePath $Node -ArgumentList @("`"$Cli`"", '--versions', '22', '--pm', 'npm') `
  -WorkingDirectory $Cwd -WindowStyle Hidden -RedirectStandardError $Log -RedirectStandardOutput "$Log.out" -PassThru
$null = $process.Handle # keeps the exit code readable after the process ends
$deadline = (Get-Date).AddMinutes(10)
while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
  if ((Test-Path $Log) -and ((Get-Content $Log -Raw) -match $Step)) { break }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 4
[W.K]::FreeConsole() | Out-Null
if (-not [W.K]::AttachConsole([uint32]$process.Id)) { Write-Output 'attach-failed'; exit 1 }
[W.K]::SetConsoleCtrlHandler([System.IntPtr]::Zero, $true) | Out-Null
[W.K]::GenerateConsoleCtrlEvent(1, [uint32]$process.Id) | Out-Null
[W.K]::FreeConsole() | Out-Null
$process.WaitForExit()
Write-Output "exit=$($process.ExitCode)"
