@echo off
chcp 65001 >nul
title Çark Petrol - Güncelleme

echo ============================================
echo    CARK PETROL - GUNCELLEME
echo ============================================
echo.

:: Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [HATA] Git bulunamadi!
    echo.
    echo Git indirmek icin asagidaki adrese gidin:
    echo https://git-scm.com/download/win
    echo.
    echo Kurulumda tum secenekleri varsayilan birakin.
    echo Kurduktan sonra bu dosyayi tekrar calistirin.
    echo.
    pause
    exit /b 1
)

echo Guncellemeler kontrol ediliyor...
echo.

git pull origin master
if %errorlevel% neq 0 (
    echo.
    echo [HATA] Guncelleme basarisiz oldu.
    echo Internet baglantinizi kontrol edin.
    pause
    exit /b 1
)

echo.
echo Paketler guncelleniyor...
call npm install

echo.
echo Proje yeniden derleniyor...
call npm run build

echo.
echo ============================================
echo    GUNCELLEME TAMAMLANDI!
echo ============================================
echo.
echo Simdi "baslat.bat" ile programi yeniden baslatin.
echo.
pause
