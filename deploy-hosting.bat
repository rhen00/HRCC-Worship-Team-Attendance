@echo off
cd /d "%~dp0"
echo Deploying to Firebase Hosting (HTTPS for phones)...
echo.
where firebase >nul 2>&1
if errorlevel 1 (
  echo Firebase CLI not found. Install once:
  echo   npm install -g firebase-tools
  echo Then: firebase login
  pause
  exit /b 1
)
firebase deploy --only hosting
echo.
echo On your phone, open:
echo   https://hrcc-worship-team-attendance.web.app
echo.
pause
