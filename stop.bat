@echo off
chcp 65001 >nul
title ClipStream Studio - Stop
cd /d "%~dp0"

echo.
echo   Stopping ClipStream Studio...
echo.

REM --- Server (this project's backend only) ---
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $c) { Write-Host '  Server is already stopped.'; exit 0 }; $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $c.OwningProcess); if (-not $p) { Write-Host '  Server process not found.'; exit 0 }; if ($p.CommandLine -like '*backend\app.py*' -or $p.CommandLine -like '*backend/app.py*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('  Server stopped. pid: ' + $p.ProcessId) } else { Write-Host '  Port 8765 is used by another application; left untouched.' }"

REM --- Pending export jobs (this project's ffmpeg processes only) ---
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*clip2*exports*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host ('  Pending exports closed: ' + ($p.ProcessId -join ', ')) } else { Write-Host '  No exports are running.' }"

REM --- Close the launcher window too ---
powershell -NoProfile -Command "$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and ($_.CommandLine -like '*backend\app.py*' -or $_.CommandLine -like '*backend/app.py*') }; if ($w) { $w | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"

echo.
echo   Done.
ping -n 5 127.0.0.1 >nul
exit /b 0
