@echo off
cd /d "%~dp0"
echo.
echo  HRCC Worship Team Attendance - Local test server
echo  ================================================
echo  Camera works at: http://localhost:8080
echo.
echo  Opening browser in 2 seconds...
echo  Press Ctrl+C here to stop the server.
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:8080/scanner.html"

where py >nul 2>&1
if %errorlevel%==0 (
  py -m http.server 8080
  goto :done
)

where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server 8080
  goto :done
)

echo Python not found. Install Python from https://www.python.org/downloads/
pause

:done
