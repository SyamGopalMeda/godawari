# Starts the API (real data, GPU detector) and the web app for a live video crowd-count check.
# Usage: .\start-video-check.ps1   then open http://localhost:5173/admin/video  (admin / admin12345)
# Stop with Ctrl+C in each window.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$api = Start-Process -PassThru -FilePath "python" -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8001" -WorkingDirectory "$root\backend" -Environment @{ PUSHKAR_SEED_MODE = "real" }
Start-Sleep -Seconds 4
$env:PUSHKAR_API_PROXY = "http://127.0.0.1:8001"
Start-Process -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js --port 5173 --strictPort" -WorkingDirectory "$root\frontend"
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173/admin/video"
Write-Host "API on http://127.0.0.1:8001 (pid $($api.Id)) - web app on http://localhost:5173 - login admin / admin12345"
