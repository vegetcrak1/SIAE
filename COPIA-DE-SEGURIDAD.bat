@echo off
cd /d "%~dp0"
call npm run backup
if "%1"=="auto" exit /b 0
echo.
echo Copie la carpeta "backups" a una memoria USB o a otro computador.
pause
