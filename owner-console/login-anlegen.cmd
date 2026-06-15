@echo off
cd /d "%~dp0"
echo ============================================
echo   Konsolen-Login anlegen (einmalig)
echo ============================================
set /p EMAIL=E-Mail (Enter = simon.messina@gmail.com):
if "%EMAIL%"=="" set EMAIL=simon.messina@gmail.com
set /p PW=Passwort waehlen (mind. 12 Zeichen):
echo.
node scripts/createPlatformAdmin.js "%EMAIL%" "%PW%" --no-2fa
echo.
echo Fertig. Jetzt start-konsole.cmd doppelklicken und anmelden.
pause
