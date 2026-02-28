@echo off
title Lucas PTY Daemon
echo.
echo   Starting PTY Daemon (long-lived process)...
echo   DO NOT use tsx watch for this process!
echo.

cd /d "%~dp0"
npx tsx server/daemon/index.ts
