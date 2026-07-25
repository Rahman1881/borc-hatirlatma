@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Telegram Bot
:loop
node telegram-bot.mjs
echo.
echo [UYARI] Telegram bot durdu, 5 sn icinde yeniden baslatiliyor...
timeout /t 5 /nobreak >nul
goto loop
