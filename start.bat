@echo off
setlocal
title PVP Dimir
cd /d "%~dp0"

echo.
echo   PVP DIMIR
echo   =========
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js was not found on this machine.
  echo.
  echo   Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo   Node %NODE_VERSION% found.
echo.

echo   Installing dependencies (first run takes a minute)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo   Install failed. Scroll up for the reason.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the game. A browser tab will open on its own.
echo   Leave this window open while you play; close it to stop the server.
echo.
call npm run dev

echo.
echo   Server stopped.
pause
