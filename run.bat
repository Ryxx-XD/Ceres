@echo off
setlocal enabledelayedexpansion

:: Get the absolute directory path where this script is located
set "SYSTEM_DIR=%~dp0"
cd /d "%SYSTEM_DIR%"

:: Verify the virtual environment python interpreter exists
set "VENV_PYTHON=venv\Scripts\python.exe"
if not exist "%VENV_PYTHON%" (
    echo Error: Virtual environment python not found at %SYSTEM_DIR%%VENV_PYTHON%.
    echo Please configure the venv under 'venv'.
    exit /b 1
)

echo =============================================
echo  Starting CERES Dashboard Server
echo =============================================
echo System directory: %SYSTEM_DIR%
echo Python virtual env: %VENV_PYTHON%
echo =============================================

:: Execute the backend app
"%VENV_PYTHON%" backend/app.py %*
