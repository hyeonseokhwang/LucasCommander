@echo off
title Lucas Command Center
echo.
echo   Starting Lucas Command Center...
echo.

cd /d "%~dp0"

:: Start backend
start "CommandCenter-Backend" cmd /c "npx tsx server/index.ts"

:: Start frontend dev server
cd frontend
start "CommandCenter-Frontend" cmd /c "npx vite --host"

echo.
echo   Backend:  http://localhost:9000
echo   Frontend: http://localhost:5175
echo.
echo   Press any key to exit...
pause >nul
