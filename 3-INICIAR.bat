@echo off
cd /d "%~dp0"
title SIAE - NO CIERRE ESTA VENTANA
echo ==========================================
echo   SIAE funcionando. NO cierre esta ventana.
echo ==========================================
:inicio
call npm start
echo.
echo El sistema se detuvo. Reiniciando en 5 segundos...
rem "ping" espera sin depender del teclado (timeout falla cuando la tarea corre oculta)
ping -n 6 127.0.0.1 >nul
goto inicio
