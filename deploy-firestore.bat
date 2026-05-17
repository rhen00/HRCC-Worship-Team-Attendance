@echo off
cd /d "%~dp0"
echo Deploying Firestore rules and indexes...
where firebase >nul 2>&1
if errorlevel 1 (
  echo Install Firebase CLI: npm install -g firebase-tools
  echo Then: firebase login
  pause
  exit /b 1
)
firebase deploy --only firestore
echo.
echo If you still see "requires an index", open the link in the browser error and click Create Index.
pause
