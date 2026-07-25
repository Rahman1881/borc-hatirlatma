@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Borc Hatirlatma - Sunucu

:: Telegram botu ayri (kucuk) pencerede, kendi kendini yeniden baslatan modda ac
start "Telegram Bot" /min cmd /c "%~dp0telegram-baslat.bat"

:: Ana uygulama - cokerse otomatik yeniden baslar
:loop
call npm start
echo.
echo [UYARI] Uygulama durdu, 5 sn icinde yeniden baslatiliyor...
timeout /t 5 /nobreak >nul
goto loop
