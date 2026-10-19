@echo off
REM ============================================================
REM  BUILD-WINDOWS.bat - نظام تسيير المستلزمات الرياضية
REM  Builds, tests, and packages the Sports Shop desktop app
REM  for Windows 10/11. Run from an elevated or normal cmd shell
REM  inside the extracted project folder.
REM ============================================================
setlocal
cd /d "%~dp0"

echo [1/6] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Install Node.js LTS from https://nodejs.org/ and re-run this script.
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo     Node version: %%v
for /f "delims=" %%v in ('npm --version') do echo     npm  version: %%v

echo.
echo [2/6] Installing dependencies (reproducible install)...
call npm ci --legacy-peer-deps
if errorlevel 1 (
    echo ERROR: npm ci failed. Check your network connection and retry.
    exit /b 1
)

echo.
echo [3/6] Rebuilding better-sqlite3 native module for Electron...
echo     NOTE: If this step fails, install "Desktop development with C++"
echo     workload from Visual Studio Build Tools, then re-run this script.
call npm run rebuild
if errorlevel 1 (
    echo ERROR: Native rebuild failed. See note above about build tools.
    exit /b 1
)

echo.
echo [4/6] Running type checks...
call npm run typecheck
if errorlevel 1 (
    echo ERROR: TypeScript check failed.
    exit /b 1
)

echo.
echo [5/6] Running automated tests...
call npm test
if errorlevel 1 (
    echo ERROR: Tests failed. Do NOT package until tests pass.
    exit /b 1
)

echo.
echo [6/6] Building the Windows NSIS installer...
call npm run build:win
if errorlevel 1 (
    echo ERROR: electron-builder packaging failed.
    exit /b 1
)

echo.
echo ============================================================
echo  SUCCESS. The installer is in the "release" folder:
dir /b release\*.exe 2>nul
echo  Database location at runtime: %%APPDATA%%\sports-shop\
echo ============================================================
endlocal
