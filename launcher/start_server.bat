@echo off
:: CERES — Silent server starter
:: Launched by launch_ceres.vbs with window hidden.
:: %~dp0 = Ceres\launcher\   so %~dp0.. = Ceres root.
pushd "%~dp0.."
"%~dp0..\venv\Scripts\python.exe" backend\app.py >> "%~dp0server.log" 2>&1
popd
