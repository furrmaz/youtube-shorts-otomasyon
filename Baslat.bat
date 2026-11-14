@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Shorts Otomasyon baslatiliyor...
call npm run baslat
pause
