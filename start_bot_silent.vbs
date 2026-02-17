' ═══════════════════════════════════════════════════════
'  Lanzador silencioso - Sr y Sra Burger Bot 🍔
'  Ejecuta start_bot.bat sin mostrar ventana de consola
' ═══════════════════════════════════════════════════════

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & Replace(WScript.ScriptFullName, "start_bot_silent.vbs", "start_bot.bat") & Chr(34), 0, False
Set WshShell = Nothing
