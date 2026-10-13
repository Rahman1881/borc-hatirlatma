@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Borc Hatirlatma - Durdur

:: Sunucuyu, Telegram botunu ve WhatsApp'in arka planda actigi Chrome'lari kapatir.
:: Guncellemeden once (guncelle.bat) ya da WhatsApp takildiginda calistirin.
:: Sonra sunucu-baslat.bat'i NORMAL cift tiklayarak (yonetici olarak degil) acin.

:: --- Yonetici kontrolu (yonetici olarak acilmis Chrome'lari kapatabilmek icin) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Bu dosyayi YONETICI olarak calistirmalisiniz.
    echo Dosyaya sag tiklayin -^> "Yonetici olarak calistir".
    pause
    exit /b 1
)

:: Once yeniden baslatma donguleri: kapatilmazsa sunucu-baslat.bat ve
:: telegram-baslat.bat, node kapaninca 5 sn sonra programi yeniden acar.
echo Yeniden baslatma donguleri kapatiliyor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and ($_.CommandLine -like '*sunucu-baslat.bat*' -or $_.CommandLine -like '*telegram-baslat.bat*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo Uygulama ve Telegram botu kapatiliyor...
taskkill /F /IM node.exe >nul 2>&1

echo WhatsApp'in arka plan Chrome'lari kapatiliyor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*wwebjs_auth*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

timeout /t 2 /nobreak >nul
echo.
echo Kalan surec sayisi (0 olmali):
powershell -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -or ($_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*wwebjs_auth*') }).Count"

echo.
echo ============================================
echo  Tamam. Simdi:
echo   1) Guncelleme varsa guncelle.bat
echo   2) sunucu-baslat.bat  (NORMAL cift tik, yonetici olarak DEGIL)
echo ============================================
pause
