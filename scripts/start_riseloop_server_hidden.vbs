Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\SpaceS\Riseloop\scripts\start_riseloop_server.ps1""", 0, False
