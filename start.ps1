# Little Less: one-click start.
# Starts the tunnel, writes its URL into backend\.env, then starts backend + frontend
# in their own windows and prints the link to open.
#
# Run from PowerShell:   & "C:\Users\CEPL\Desktop\Little less\start.ps1"
# (If Windows blocks scripts: powershell -ExecutionPolicy Bypass -File "C:\Users\CEPL\Desktop\Little less\start.ps1")

$root = $PSScriptRoot
$envFile = Join-Path $root 'backend\.env'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$log = Join-Path $env:TEMP 'little-less-tunnel.log'

Write-Host "`nStarting Little Less..." -ForegroundColor Yellow

# 1. Stop anything left over from a previous run.
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
foreach ($port in 8000, 5173) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# 2. Start the tunnel and wait for its public URL.
if (Test-Path $log) { Remove-Item $log -Force }
Start-Process -FilePath $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:5173' `
  -RedirectStandardError $log -WindowStyle Minimized
$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { Write-Host 'Could not start the tunnel. Check your internet and try again.' -ForegroundColor Red; exit 1 }

# 3. Save the URL so Agora's agent can reach our brain.
$content = Get-Content $envFile -Raw
$content = $content -replace '(?m)^PUBLIC_URL=.*$', "PUBLIC_URL=$url"
[System.IO.File]::WriteAllText($envFile, $content)

# 4. Start backend and frontend in their own windows.
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"

# 5. Wait until the public link actually works.
Write-Host 'Waiting for everything to come online...'
$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $ok = (Invoke-RestMethod "$url/api/health" -TimeoutSec 5).ok } catch { }
}

Write-Host ''
Write-Host '  Little Less is running!' -ForegroundColor Green
Write-Host "  Laptop:          http://localhost:5173"
Write-Host "  Phone / anyone:  $url" -ForegroundColor Cyan
if (-not $ok) { Write-Host '  (The public link may need another 30 seconds to start working.)' -ForegroundColor Yellow }
Write-Host ''
Start-Process $url
