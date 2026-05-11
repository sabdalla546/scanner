@echo off
title Roses Scanner Agent

cd /d G:\KUWAIT_2025\Scanner\scanner-electron

set NAPS2_PATH=C:\Program Files\NAPS2\NAPS2.Console.exe
set NAPS2_PROFILE_NAME=Signed Contract Scanner
set SCANNER_HTTP_PORT=17855
set SCANNER_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://phpstack-909502-6336771.cloudwaysapps.com

npm start

pause