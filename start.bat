@echo off
setlocal
cd /d "%~dp0"
title SmartClassroom - Trinh Chieu Thoi Gian Thuc

echo ========================================================
echo   SMARTCLASSROOM - HE THONG TRINH CHIEU LOP HOC
echo ========================================================
echo.

set "PY="

if exist "C:\ProgramData\miniconda3\python.exe" (
    set "PY=C:\ProgramData\miniconda3\python.exe"
) else (
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined PY (
            echo %%i | findstr /i "WindowsApps" >nul
            if errorlevel 1 set "PY=%%i"
        )
    )
)

if not defined PY (
    set "PY=python"
)

echo [*] Dang su dung: %PY%
echo [*] Dang khoi chay he thong...
echo.

"%PY%" run.py
if errorlevel 1 pause
