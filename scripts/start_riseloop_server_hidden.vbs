Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")
Dim scriptPath
scriptPath = Fso.GetParentFolderName(WScript.ScriptFullName) & "\start_riseloop_server.ps1"
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """", 0, False
