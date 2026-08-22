@echo off
title NetPlus AI - Network Fault Diagnosis & Wi-Fi Survey
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org and run again.
  pause
  exit /b 1
)
echo ==========================================
echo  NetPlus AI - starting server...
echo  Open http://localhost:3000 in your browser
echo  (Port/host can be changed in config.json)
echo ==========================================
node server.js
pause
