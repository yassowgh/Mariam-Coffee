' Starts the uploader with no window (used by Windows Task Scheduler).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\MariamCoffeeUploader.ps1""", 0, False
