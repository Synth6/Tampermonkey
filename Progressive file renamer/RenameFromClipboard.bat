@echo off
setlocal EnableExtensions

if "%~1"=="" (
  echo Drag one or more PDF files onto this script.
  pause
  exit /b 1
)

set "PS1=%~dp0RenameFromClipboard.ps1"
if not exist "%PS1%" (
  echo Missing: "%PS1%"
  pause
  exit /b 1
)

set "LIST=%TEMP%\mci_drag_list_%RANDOM%.txt"
del "%LIST%" >nul 2>&1

:loop
if "%~1"=="" goto run
>>"%LIST%" echo %~f1
shift
goto loop

:run
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%PS1%" -PathList "%LIST%"

set "RC=%ERRORLEVEL%"
del "%LIST%" >nul 2>&1

if not "%RC%"=="0" (
  echo.
  echo Rename failed. See error above.
  pause
  exit /b %RC%
)

exit /b 0