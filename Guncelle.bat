@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Acik olan uygulama kapatiliyor...
taskkill /IM node.exe /F >nul 2>&1
node scripts\guncelle.mjs
pause
