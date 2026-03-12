@echo off
chcp 65001 >nul
title Çark Petrol - Kurulum

echo ============================================
echo    CARK PETROL - KURULUM
echo ============================================
echo.

:: Check and install Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js bulunamadi, otomatik kuruluyor...
    echo.
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [HATA] Node.js otomatik kurulamadi.
        echo Lutfen manuel kurun: https://nodejs.org
        pause
        exit /b 1
    )
    echo.
    echo [OK] Node.js kuruldu! Degisikliklerin aktif olmasi icin
    echo bu pencereyi kapatip kur.bat'i tekrar calistirin.
    echo.
    pause
    exit /b 0
)

echo [OK] Node.js bulundu:
node --version
echo.

:: Check and install Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo Git bulunamadi, otomatik kuruluyor...
    echo.
    winget install Git.Git --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [UYARI] Git otomatik kurulamadi.
        echo Guncellemeler icin sonra manuel kurabilirsiniz: https://git-scm.com
        echo Simdilik devam ediyoruz...
        echo.
    ) else (
        echo [OK] Git kuruldu!
        echo.
    )
)

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
