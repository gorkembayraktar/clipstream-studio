@echo off
chcp 65001 >nul
title ClipStream Studio - Launcher
cd /d "%~dp0"

echo.
echo   ==========================================
echo    ClipStream Studio
echo   ==========================================
echo.

REM --- 1) Is the server already running? ---
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   Server is already running: http://127.0.0.1:8765
  start "" "http://127.0.0.1:8765"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

REM --- 2) Is Python installed? ---
where python >nul 2>nul
if errorlevel 1 (
  echo   ERROR: Python was not found.
  echo   Install it and add it to PATH: https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

REM --- 3) Build the UI ---
if not exist "frontend\dist\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo   ERROR: The UI is not built and npm was not found.
    echo   Install Node.js and add it to PATH: https://nodejs.org/
    echo.
    pause
    exit /b 1
  )

  if not exist "frontend\node_modules" (
    echo   Installing UI dependencies - first run...
    pushd frontend
    call npm install
    if errorlevel 1 (
      popd
      echo.
      echo   ERROR: npm install failed.
      pause
      exit /b 1
    )
    popd
  )

  echo   Building the UI...
  pushd frontend
  call npm run build
  if errorlevel 1 (
    popd
    echo.
    echo   ERROR: UI build failed.
    pause
    exit /b 1
  )
  popd
)

REM --- 4) Optional tools ---
where ffmpeg >nul 2>nul
if errorlevel 1 echo   WARNING: ffmpeg is not on PATH; export will not work. Add C:\ffmpeg\bin to PATH.
python -m yt_dlp --version >nul 2>nul
if errorlevel 1 echo   WARNING: yt-dlp is missing; YouTube/X/Instagram links cannot be resolved. Install it with: pip install -U yt-dlp

REM --- 5) Start the server in a separate window ---
echo   Starting the server...
set "PYTHON_EXE="
for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
if not defined PYTHON_EXE set "PYTHON_EXE=python"
start "ClipStream Server" cmd /k "chcp 65001 >nul & ""%PYTHON_EXE%"" backend\app.py"

REM --- 6) Wait for the server to come up ---
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if not errorlevel 1 goto ready
  ping -n 2 127.0.0.1 >nul
)

echo   ERROR: The server did not start within 30 seconds.
echo   Check the error message in the "ClipStream Server" window.
echo.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8765"
echo   Ready! URL: http://127.0.0.1:8765
echo   To stop it: stop.bat
ping -n 5 127.0.0.1 >nul
exit /b 0
