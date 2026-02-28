@echo off
title Lucas Command Center
echo.
echo   Starting Lucas Command Center...
echo.

cd /d "%~dp0"

:: Start PTY Daemon (long-lived, no tsx watch)
start "PTY-Daemon" cmd /c "npx tsx server/daemon/index.ts"

:: Wait for daemon to bind port
timeout /t 2 /nobreak >nul

:: Start backend web server (tsx watch OK — safe to restart)
start "CommandCenter-Backend" cmd /c "npx tsx watch server/index.ts"

:: Start frontend dev server
cd frontend
start "CommandCenter-Frontend" cmd /c "npx vite --host"

echo.
echo   PTY Daemon:  localhost:9100 (long-lived)
echo   Backend:     http://localhost:9000 (restartable)
echo   Frontend:    http://localhost:5175
echo.
echo   Press any key to exit...
pause >nul
