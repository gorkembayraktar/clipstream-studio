@echo off
chcp 65001 >nul
title ClipStream Studio - Gelistirme
cd /d "%~dp0.."

echo.
echo   ClipStream Studio - Gelistirme
echo   ==========================================
echo.

REM --- 8765 zaten kullaniliyor mu? ---
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   UYARI: 8765 portu zaten kullanimda.
  echo   Once durdur.bat ile calisan sunucuyu kapat.
  echo.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo   HATA: Python bulunamadi.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo   HATA: npm bulunamadi.
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo   Arayuz bagimliliklari kuruluyor...
  pushd frontend
  call npm install
  if errorlevel 1 (
    popd
    echo.
    echo   HATA: npm install basarisiz.
    pause
    exit /b 1
  )
  popd
)

echo   Backend ve arayuz ayri pencerelerde baslatiliyor...
start "ClipStream Backend (8765)" /D "%~dp0.." cmd /k "chcp 65001 >nul & python backend\app.py"
start "ClipStream Frontend (5173)" /D "%~dp0..\frontend" cmd /k "chcp 65001 >nul & npm run dev"

echo.
echo   Backend  : http://127.0.0.1:8765  (API)
echo   Frontend : http://127.0.0.1:5173  (gelistirmede bunu kullan)
echo.
echo   Kapatmak icin iki pencereyi de kapatin.
ping -n 5 127.0.0.1 >nul
exit /b 0
