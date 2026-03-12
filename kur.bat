@echo off
chcp 65001 >nul
title Çark Petrol - Kurulum

echo ============================================
echo    CARK PETROL - KURULUM
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo.
    echo Node.js indirmek icin asagidaki adrese gidin:
    echo https://nodejs.org
    echo.
    echo "LTS" yazan yesil butona tiklayin ve kurun.
    echo Kurulumda tum secenekleri varsayilan birakin, Next Next yapin.
    echo.
    echo Node.js kurduktan sonra bu dosyayi tekrar calistirin.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js bulundu:
node --version
echo.

echo Gerekli paketler yukleniyor... (ilk seferde 2-3 dakika surebilir)
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [HATA] Paket yuklemesi basarisiz oldu.
    echo Lutfen internet baglantinizi kontrol edin.
    pause
    exit /b 1
)

echo.
echo Proje derleniyor...
echo.
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [HATA] Derleme basarisiz oldu.
    pause
    exit /b 1
)

echo.
echo ============================================
echo    KURULUM TAMAMLANDI!
echo ============================================
echo.
echo Simdi "baslat.bat" dosyasina cift tiklayarak
echo programi calistirabilirsiniz.
echo.
pause
