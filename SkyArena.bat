@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
cd /d "%ROOT%"
if errorlevel 1 (
  echo  [fail] could not cd to repo root
  pause
  exit /b 1
)
set "TITLE=SkyArena - viewer"
set "URL=http://127.0.0.1:5444/app/"
set "VPY=%ROOT%\.venv\Scripts\python.exe"

if /I "%~1"=="--here" goto :run

start "%TITLE%" /D "%ROOT%" cmd /k "%~f0" --here
exit /b 0

:run
title %TITLE%
if not exist "%VPY%" (
  echo  [fail] missing .venv. Run scriptssetup.py first.
  echo.
  pause
  exit /b 1
)
if not exist "%ROOT%\data\curated\fly.parquet" (
  echo  [fail] curated data missing. Run scriptssetup.py first.
  echo.
  pause
  exit /b 1
)

echo  Repo: %ROOT%
"%VPY%" "%ROOT%\scripts\serve.py" --stop
if errorlevel 1 (
  echo  [fail] could not stop a leftover viewer on this repo
  pause
  exit /b 1
)
echo  Opening %URL% once the server is listening
echo  Leave this window open. Ctrl+C to stop.
"%VPY%" "%ROOT%\scripts\serve.py" --open
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo  Viewer failed. Scroll up.
)
pause
exit /b %ERR%
