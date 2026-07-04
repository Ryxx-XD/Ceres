Set fso      = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' ── Resolve paths ─────────────────────────────────────────────────────────────
' This script lives in: Ceres\launcher\launch_ceres.vbs
Dim launcherDir, projectDir
launcherDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir  = fso.GetParentFolderName(launcherDir)

Dim batFile, bootHtml
batFile  = launcherDir & "\start_server.bat"
bootHtml = launcherDir & "\boot.html"

' ── Locate Best Available Browser (Chrome, Firefox, Edge, Brave, Opera) ───────
Dim candidates(20)
Dim count
count = 0

' --- 1. Google Chrome ---
candidates(count) = "C:\Program Files\Google\Chrome\Application\chrome.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" : count = count + 1
candidates(count) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe" : count = count + 1

' --- 2. Mozilla Firefox ---
candidates(count) = "C:\Program Files\Mozilla Firefox\firefox.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\Mozilla Firefox\firefox.exe" : count = count + 1
candidates(count) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Mozilla Firefox\firefox.exe" : count = count + 1

' --- 3. Microsoft Edge ---
candidates(count) = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" : count = count + 1
candidates(count) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe" : count = count + 1

' --- 4. Brave Browser ---
candidates(count) = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe" : count = count + 1
candidates(count) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\BraveSoftware\Brave-Browser\Application\brave.exe" : count = count + 1

' --- 5. Opera Browser ---
candidates(count) = "C:\Program Files\Opera\launcher.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\Opera\launcher.exe" : count = count + 1
candidates(count) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Opera\launcher.exe" : count = count + 1
candidates(count) = "C:\Program Files\Opera\opera.exe" : count = count + 1
candidates(count) = "C:\Program Files (x86)\Opera\opera.exe" : count = count + 1

' --- Fallbacks ---
candidates(count) = "chrome.exe" : count = count + 1
candidates(count) = "firefox.exe" : count = count + 1
candidates(count) = "msedge.exe" : count = count + 1
candidates(count) = "brave.exe" : count = count + 1

Dim browserPath, isFirefox
browserPath = ""
isFirefox = False

Dim i
For i = 0 To count - 1
    If candidates(i) <> "" Then
        If InStr(candidates(i), "\") = 0 Then
            browserPath = candidates(i)
            Exit For
        ElseIf fso.FileExists(candidates(i)) Then
            browserPath = candidates(i)
            Exit For
        End If
    End If
Next

If browserPath = "" Then
    browserPath = "chrome.exe"
End If

If InStr(LCase(browserPath), "firefox.exe") > 0 Then
    isFirefox = True
End If

' ── 1. Start the Python backend via the reliable batch file ───────────────────
'    Window style 0 = completely hidden; False = don't wait for it to finish.
WshShell.Run "cmd /c """ & batFile & """", 0, False

' ── 2. Open the boot screen in the detected browser ──────────────────────────
Dim browserCmd
If isFirefox Then
    browserCmd = """" & browserPath & """ -new-window """ & bootHtml & """"
Else
    browserCmd = """" & browserPath & """" _
        & " --new-window" _
        & " --no-first-run" _
        & " --disable-infobars" _
        & " --disable-extensions" _
        & " """ & bootHtml & """"
End If

' Run browser (window style 3 = maximized so F11 works cleanly)
WshShell.Run browserCmd, 3, False

' ── 2.5. Start the background shutdown monitor in PowerShell (hidden) ──────────
Dim monitorCmd
monitorCmd = "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & launcherDir & "\monitor_shutdown.ps1"""
WshShell.Run monitorCmd, 0, False

' ── 3. Press F11 to enter true fullscreen (browser-chrome fullscreen) ─────────
' Retry until Edge's window title contains "CERES" (page loaded) or time out.
Dim activated, attempts
activated = False
attempts  = 0

Do While Not activated And attempts < 40
    WScript.Sleep 400
    activated = WshShell.AppActivate("CERES")
    If Not activated Then activated = WshShell.AppActivate("boot.html")
    If Not activated Then activated = WshShell.AppActivate("Initializing")
    attempts = attempts + 1
Loop

If activated Then
    WshShell.SendKeys "{F11}"
End If
