$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
$port = 8000
$logDir = Join-Path $projectRoot "logs"
$stdoutLog = Join-Path $logDir "riseloop-server.out.log"
$stderrLog = Join-Path $logDir "riseloop-server.err.log"

function Test-RiseloopPortListening {
  try {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
    return $null -ne $listener
  } catch {
    return $false
  }
}

function Get-PythonCommand {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @{ FilePath = $py.Source; Arguments = @('-m', 'http.server', [string]$port) }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @{ FilePath = $python.Source; Arguments = @('-m', 'http.server', [string]$port) }
  }

  $python3 = Get-Command python3 -ErrorAction SilentlyContinue
  if ($python3) {
    return @{ FilePath = $python3.Source; Arguments = @('-m', 'http.server', [string]$port) }
  }

  throw 'Python was not found. Install Python or update the Riseloop startup script.'
}

if (-not (Test-Path $projectRoot)) {
  throw "Riseloop project folder not found at $projectRoot"
}

$null = New-Item -ItemType Directory -Path $logDir -Force

if (Test-RiseloopPortListening) {
  exit 0
}

$pythonCommand = Get-PythonCommand

Start-Process -FilePath $pythonCommand.FilePath `
  -ArgumentList $pythonCommand.Arguments `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

Start-Sleep -Seconds 2

if (-not (Test-RiseloopPortListening)) {
  throw "Riseloop server did not start on port $port"
}
