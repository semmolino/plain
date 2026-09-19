@echo off
cd /d "%~dp0"
echo ============================================
echo   plan^&simple Owner-Konsole startet...
echo.
echo   Der Start oeffnet zuerst den Tunnel zur
echo   Scalingo-Datenbank und startet PostgREST
echo   davor - das dauert ein paar Sekunden.
echo.
echo   Im Browser oeffnen: http://localhost:4000
echo   (Zum Beenden Strg+C oder dieses Fenster schliessen.)
echo ============================================
node scripts/start.js
pause
