# Starts the API (real data, GPU detector) and the web app for a live video crowd-count check.
# Usage: .\start-video-check.ps1   then open http://localhost:5173/admin/video  (admin / admin12345)
# Works in Windows PowerShell 5.1 and PowerShell 7. Stop with Ctrl+C in each window.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PUSHKAR_SEED_MODE = 'real'   # the backend default; set explicitly so a shell that exported 'demo' does not leak in
$api = Start-Process -PassThru -FilePath "python" -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8001" -WorkingDirectory "$root\backend"
if (-not $api) { Write-Error 'API did not start'; exit 1 }
Start-Sleep -Seconds 4
if ($api.HasExited) { Write-Error "API exited with code $($api.ExitCode); see the API window for the error"; exit 1 }
$env:PUSHKAR_API_PROXY = "http://127.0.0.1:8001"
Start-Process -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js --port 5173 --strictPort" -WorkingDirectory "$root\frontend"
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173/admin/video"
Write-Host "API on http://127.0.0.1:8001 (pid $($api.Id)) - web app on http://localhost:5173 - login admin / admin12345"
