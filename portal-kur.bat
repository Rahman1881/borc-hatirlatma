@echo off
chcp 65001 >nul
title Portal Kurulum - Borc Hatirlatma
cd /d "%~dp0"

echo ============================================
echo   PORTAL KURULUM - portal.ozciftcipetrol.com
echo ============================================
echo.

:: --- Yonetici kontrolu (servis kurmak icin gerekli) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Bu dosyayi YONETICI olarak calistirmalisiniz.
    echo Dosyaya sag tiklayin -^> "Yonetici olarak calistir".
    pause
    exit /b 1
)

:: --- Node.js ---
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js bulunamadi, kuruluyor...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    echo.
    echo [OK] Node.js kuruldu.
    echo Bu pencereyi KAPATIP portal-kur.bat'i TEKRAR calistirin.
    pause
    exit /b 0
)
echo [OK] Node.js bulundu:
node --version
echo.

:: --- Eski (Mac'ten kopyalanmis olabilecek) derlemeleri temizle ---
echo Temiz kurulum icin eski dosyalar temizleniyor...
if exist node_modules rmdir /s /q node_modules
if exist .next rmdir /s /q .next
echo.

:: --- Bagimliliklar ---
echo Paketler yukleniyor... (ilk seferde birkac dakika surer)
call npm install
if %errorlevel% neq 0 (
    echo [HATA] Paket yuklemesi basarisiz. Internet baglantisini kontrol edin.
    pause
    exit /b 1
)
echo.

:: --- Derleme ---
echo Proje derleniyor...
call npm run build
if %errorlevel% neq 0 (
    echo [HATA] Derleme basarisiz.
    pause
    exit /b 1
)
echo.

:: --- cloudflared indir ---
if not exist "cloudflared.exe" (
    echo cloudflared indiriliyor...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if not exist "cloudflared.exe" (
        echo [HATA] cloudflared indirilemedi.
        pause
        exit /b 1
    )
)
echo [OK] cloudflared hazir.
echo.

:: --- Acilista otomatik baslatma (Baslangic klasorune kisayol) ---
echo Otomatik baslatma ayarlaniyor...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $p=[Environment]::GetFolderPath('Startup')+'\BorcHatirlatma.lnk'; $s=$w.CreateShortcut($p); $s.TargetPath='%~dp0sunucu-baslat.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo [OK] Bilgisayar acildiginda uygulama otomatik baslayacak.
echo.

:: --- Cloudflare Tunnel servisi ---
echo ============================================
echo  Cloudflare Tunnel TOKEN'ini yapistirip Enter'a basin.
echo  (Cloudflare Zero Trust panelinde tunnel olustururken
echo   size verilen uzun kod. Bos birakip Enter'a basarsaniz
echo   bu adim atlanir, sonra kurabilirsiniz.)
echo ============================================
set /p CFTOKEN="Token: "
if "%CFTOKEN%"=="" (
    echo [UYARI] Token girilmedi, tunnel servisi kurulmadi.
    echo Sonra kurmak icin bu klasorde: cloudflared.exe service install TOKEN
) else (
    cloudflared.exe service install %CFTOKEN%
    echo [OK] Tunnel servisi kuruldu (bilgisayar acilinca otomatik calisir).
)
echo.

:: --- Uygulamayi hemen baslat ---
start "" "%~dp0sunucu-baslat.bat"

echo ============================================
echo    KURULUM TAMAMLANDI!
echo ============================================
echo.
echo Uygulama baslatildi. Birkac dakika icinde su adresten
echo erisilebilir olacak:
echo.
echo    https://portal.ozciftcipetrol.com
echo.
pause
