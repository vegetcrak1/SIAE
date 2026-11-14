@echo off
cd /d "%~dp0"
echo ==========================================
echo   Instalando SIAE (esto tarda unos minutos)
echo ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 goto sinnode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto nodeviejo
call npm install --no-audit --no-fund
if errorlevel 1 goto fallo
call npm run init
if errorlevel 1 goto fallo
call npm run build
if errorlevel 1 goto fallo
echo.
echo ==========================================
echo   LISTO. Ahora abra "2-CREAR-ADMINISTRADOR.bat"
echo ==========================================
pause
exit /b 0
:sinnode
echo No se encontro Node.js. Instalelo desde https://nodejs.org (boton verde LTS) y vuelva a abrir este archivo.
pause
exit /b 1
:nodeviejo
echo Su Node.js es muy antiguo. Instale la version 22 o mayor desde https://nodejs.org (boton verde LTS).
pause
exit /b 1
:fallo
echo.
echo Algo fallo. Revise que el computador tenga internet y vuelva a abrir este archivo.
pause
exit /b 1
