@echo off
cd /d "%~dp0"
echo ============================================
echo   PlaIn Owner-Konsole startet...
echo   Im Browser oeffnen: http://localhost:4000
echo   (Zum Beenden dieses Fenster schliessen.)
echo ============================================
start "" http://localhost:4000
node server.js
pause
