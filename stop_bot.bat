@echo off
REM ═══════════════════════════════════════════════════════
REM  Detener Bot - Sr y Sra Burger 🍔
REM  Cierra Flask y Bridge
REM ═══════════════════════════════════════════════════════

echo Deteniendo bot...

REM Cerrar por puerto 5000 (Flask)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo Cerrando Flask (PID %%a)...
    taskkill /f /pid %%a 2>nul
)

REM Cerrar por puerto 3001 (Bridge)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
    echo Cerrando Bridge (PID %%a)...
    taskkill /f /pid %%a 2>nul
)

echo Bot detenido!
pause
