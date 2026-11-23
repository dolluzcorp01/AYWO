@echo off
rem Reconnects a plugged-in Android phone to the AYWO app and server running on this computer, then opens the app.
rem Run it after plugging the phone in (double-click). The phone needs USB debugging on.
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo No phone found. Plug it in, unlock it, and tap Allow if it asks about USB debugging. Then run this again.
  pause
  exit /b 1
)

rem The app on the phone reaches the code server (8081), the AYWO server (3000) and the picture storage (9000)
rem through the cable.
"%ADB%" reverse tcp:8081 tcp:8081 >nul
"%ADB%" reverse tcp:3000 tcp:3000 >nul
"%ADB%" reverse tcp:9000 tcp:9000 >nul
"%ADB%" shell am start -a android.intent.action.VIEW -d "exp+aywo://expo-development-client/?url=http%%3A%%2F%%2Flocalhost%%3A8081" in.aywo.app >nul 2>&1

echo Phone connected. AYWO is opening on the phone.
timeout /t 4 >nul
