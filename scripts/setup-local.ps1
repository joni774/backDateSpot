# Local setup and E2E verification (Windows)
# Requires Docker Desktop OR a local PostgreSQL on port 5432

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "DateSpot local setup" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

$pgRunning = $false
try {
  $tcp = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
  $pgRunning = $tcp.TcpTestSucceeded
} catch {}

if (-not $pgRunning) {
  Write-Host ""
  Write-Host "PostgreSQL is not running on localhost:5432." -ForegroundColor Yellow
  Write-Host "Start it with: docker compose up -d" -ForegroundColor Yellow
  Write-Host "Then re-run this script." -ForegroundColor Yellow
  exit 1
}

Write-Host "Running migrations..."
pnpm db:migrate

Write-Host "Seeding database..."
pnpm db:seed

Write-Host "Starting API in background..."
$apiJob = Start-Job -ScriptBlock {
  Set-Location $using:root
  pnpm --filter api dev
}

Start-Sleep -Seconds 8

Write-Host "Running E2E smoke test..."
pnpm e2e
$e2eExit = $LASTEXITCODE

Stop-Job $apiJob -ErrorAction SilentlyContinue
Remove-Job $apiJob -Force -ErrorAction SilentlyContinue

if ($e2eExit -eq 0) {
  Write-Host "E2E verification passed!" -ForegroundColor Green
} else {
  Write-Host "E2E verification failed." -ForegroundColor Red
  exit $e2eExit
}
