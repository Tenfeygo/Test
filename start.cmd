@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  npm install
)

if not exist ".env" (
  echo.
  echo .env not found. Please create .env with:
  echo OPENAI_API_KEY=your_key_here
  echo.
  pause
  exit /b 1
)

echo Starting server...
start "" "http://localhost:3000"
npm run dev
