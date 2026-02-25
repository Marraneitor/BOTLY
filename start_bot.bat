@echo off
REM ═══════════════════════════════════════════════════════
REM  Script de inicio automático - Sr y Sra Burger Bot 🍔
REM  Inicia Flask (puerto 5000) y Bridge WhatsApp (puerto 3001)
REM ═══════════════════════════════════════════════════════

cd /d "%~dp0"

REM Esperar 15 segundos para que Windows termine de cargar e internet esté listo
echo [%date% %time%] Esperando 15 segundos para que la red esté lista... >> bot_startup.log
timeout /t 15 /nobreak >nul

REM Matar procesos anteriores si existen (evitar puertos ocupados)
echo [%date% %time%] Cerrando procesos anteriores... >> bot_startup.log
taskkill /f /im "node.exe" /fi "WINDOWTITLE eq bridge*" 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul

REM Iniciar Flask backend
echo [%date% %time%] Iniciando Flask backend... >> bot_startup.log
start "BurgerBot-Flask" /min cmd /c "cd /d "%~dp0" && python app.py >> flask_output.log 2>&1"

REM Esperar 5 segundos para que Flask esté listo
timeout /t 5 /nobreak >nul

REM Iniciar Bridge de WhatsApp
echo [%date% %time%] Iniciando Bridge WhatsApp... >> bot_startup.log
start "BurgerBot-Bridge" /min cmd /c "cd /d "%~dp0" && node bridge.js >> bridge_output.log 2>&1"

echo [%date% %time%] Bot iniciado correctamente! >> bot_startup.log
