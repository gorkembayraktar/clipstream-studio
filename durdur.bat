@echo off
chcp 65001 >nul
title ClipStream Studio - Durdur
cd /d "%~dp0"

echo.
echo   ClipStream Studio durduruluyor...
echo.

REM --- Sunucu (yalnizca bu projenin backend'i) ---
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $c) { Write-Host '  Sunucu zaten kapali.'; exit 0 }; $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $c.OwningProcess); if (-not $p) { Write-Host '  Sunucu sureci bulunamadi.'; exit 0 }; if ($p.CommandLine -like '*backend\app.py*' -or $p.CommandLine -like '*backend/app.py*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('  Sunucu durduruldu. pid: ' + $p.ProcessId) } else { Write-Host '  8765 portu baska bir uygulama tarafindan kullaniliyor; dokunulmadi.' }"

REM --- Bekleyen disa aktarma isleri (yalnizca bu projenin ffmpeg surecleri) ---
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*clip2*exports*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host ('  Bekleyen aktarimlar kapatildi: ' + ($p.ProcessId -join ', ')) } else { Write-Host '  Calisan aktarim yok.' }"

REM --- Baslatici penceresini de kapat ---
powershell -NoProfile -Command "$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and ($_.CommandLine -like '*backend\app.py*' -or $_.CommandLine -like '*backend/app.py*') }; if ($w) { $w | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"

echo.
echo   Bitti.
ping -n 5 127.0.0.1 >nul
exit /b 0
