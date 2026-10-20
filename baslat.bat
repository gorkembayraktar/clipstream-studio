@echo off
chcp 65001 >nul
title ClipStream Studio - Baslatici
cd /d "%~dp0"

echo.
echo   ==========================================
echo    ClipStream Studio
echo   ==========================================
echo.

REM --- 1) Sunucu zaten calisiyor mu? ---
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   Sunucu zaten calisiyor: http://127.0.0.1:8765
  start "" "http://127.0.0.1:8765"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

REM --- 2) Python kurulu mu? ---
where python >nul 2>nul
if errorlevel 1 (
  echo   HATA: Python bulunamadi.
  echo   Kurup PATH'e ekleyin: https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

REM --- 3) Arayuz derlemesi ---
if not exist "frontend\dist\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo   HATA: Arayuz derlemesi yok ve npm bulunamadi.
    echo   Node.js kurup PATH'e ekleyin: https://nodejs.org/
    echo.
    pause
    exit /b 1
  )

  if not exist "frontend\node_modules" (
    echo   Arayuz bagimliliklari kuruluyor - ilk sefer...
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

  echo   Arayuz derleniyor...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    popd
    echo.
    echo   HATA: Arayuz derlemesi basarisiz.
    pause
    exit /b 1
  )
  popd
)

REM --- 4) Opsiyonel araclar ---
where ffmpeg >nul 2>nul
if errorlevel 1 echo   UYARI: ffmpeg PATH'te yok, disa aktarma calismaz. C:\ffmpeg\bin yolunu PATH'e ekleyin.
python -m yt_dlp --version >nul 2>nul
if errorlevel 1 echo   UYARI: yt-dlp yok, YouTube/X/Instagram cozulemez. Kurmak icin: pip install -U yt-dlp

REM --- 5) Sunucuyu ayri pencerede baslat ---
echo   Sunucu baslatiliyor...
start "ClipStream Sunucu" cmd /k "chcp 65001 >nul & python backend\app.py"

REM --- 6) Sunucunun ayaga kalkmasini bekle ---
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if not errorlevel 1 goto ready
  ping -n 2 127.0.0.1 >nul
)

echo   HATA: Sunucu 30 saniyede acilmadi.
echo   "ClipStream Sunucu" penceresindeki hata mesajina bakin.
echo.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8765"
echo   Hazir! Adres: http://127.0.0.1:8765
echo   Kapatmak icin: durdur.bat
ping -n 5 127.0.0.1 >nul
exit /b 0
