@echo off
echo Starting API server...
start "HILS API Server" /D "%~dp0backend" node server.js
echo Starting Vite...
pushd "%~dp0"
npx vite > vite.log 2>&1
echo.
echo Vite stopped. See vite.log for details.
pause
popd
