@echo off
chcp 65001 >nul
title Borç Hatırlatma Sistemi

echo ============================================
echo    BORC HATIRLATMA SISTEMI
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo Lutfen once "kur.bat" dosyasini calistirin.
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo Ilk calistirma tespit edildi, kurulum yapiliyor...
    echo.
    call npm install
    call npm run build
)

:: Check if .next build folder exists
if not exist ".next" (
    echo Proje derleniyor...
    call npm run build
)

echo Program baslatiliyor...
echo.

:: Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set "LOCAL_IP=%%a"
    goto :found_ip
)
:found_ip
set "LOCAL_IP=%LOCAL_IP: =%"

echo ============================================
echo   Bu bilgisayarda:  http://localhost:3000
echo   Diger bilgisayar: http://%LOCAL_IP%:3000
echo.
echo   Programi kapatmak icin bu pencereyi kapatin.
echo ============================================
echo.

:: Open browser automatically
start http://localhost:3000

:: Start the server
call npm start
