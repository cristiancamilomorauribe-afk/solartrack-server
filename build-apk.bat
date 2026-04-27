@echo off
chcp 65001 >nul
title SolarTrack — Generador de APK

echo.
echo ══════════════════════════════════════════════════════
echo    SolarTrack — Construccion del APK
echo ══════════════════════════════════════════════════════
echo.

:: ── Verificar Node.js ──────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no encontrado.
    echo         Descargalo en: https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

:: ── Verificar Java ─────────────────────────────────────
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Java no encontrado.
    echo         Android Studio lo instala automaticamente.
    echo         Descarga Android Studio en:
    echo         https://developer.android.com/studio
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('java -version 2^>^&1') do (set JAVA_VER=%%i & goto :java_ok)
:java_ok
echo [OK] Java detectado

:: ── Verificar Android SDK ──────────────────────────────
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
    ) else (
        echo.
        echo [ERROR] Android SDK no encontrado.
        echo         Abre Android Studio ^> SDK Manager y acepta las licencias.
        echo.
        pause & exit /b 1
    )
)
echo [OK] Android SDK en %ANDROID_HOME%

echo.
echo ── Paso 1: Descargando librerias locales ──────────────
node download-libs.js
if %errorlevel% neq 0 (
    echo [WARN] Algunas librerias no se descargaron. Continua igual.
)

echo.
echo ── Paso 2: Instalando dependencias Capacitor ──────────
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Fallo npm install
    pause & exit /b 1
)

echo.
echo ── Paso 3: Inicializando Capacitor ────────────────────
if not exist "android" (
    call npx cap add android
    if %errorlevel% neq 0 (
        echo [ERROR] Fallo cap add android
        pause & exit /b 1
    )
) else (
    echo [OK] Plataforma Android ya existe
)

echo.
echo ── Paso 4: Sincronizando archivos web ─────────────────
call npx cap sync android
if %errorlevel% neq 0 (
    echo [ERROR] Fallo cap sync
    pause & exit /b 1
)

echo.
echo ── Paso 5: Copiando configuracion Android ─────────────
if exist "android\app\src\main\res\values\strings.xml" (
    powershell -Command "(Get-Content 'android\app\src\main\res\values\strings.xml') -replace 'SolarTrack', 'SolarTrack' | Set-Content 'android\app\src\main\res\values\strings.xml'"
)

:: Permisos necesarios en AndroidManifest.xml
set MANIFEST=android\app\src\main\AndroidManifest.xml
if exist "%MANIFEST%" (
    powershell -Command ^
        "$c = Get-Content '%MANIFEST%' -Raw;" ^
        "if ($c -notmatch 'ACCESS_BACKGROUND_LOCATION') {" ^
        "  $c = $c -replace '</manifest>', '<uses-permission android:name=""android.permission.ACCESS_FINE_LOCATION""/><uses-permission android:name=""android.permission.ACCESS_COARSE_LOCATION""/><uses-permission android:name=""android.permission.ACCESS_BACKGROUND_LOCATION""/><uses-permission android:name=""android.permission.INTERNET""/><uses-permission android:name=""android.permission.ACCESS_NETWORK_STATE""/></manifest>';" ^
        "  Set-Content '%MANIFEST%' $c;" ^
        "  Write-Host '[OK] Permisos GPS y red agregados'" ^
        "}"
)

echo.
echo ── Paso 6: Construyendo APK debug ─────────────────────
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Fallo la construccion del APK.
    echo         Abre Android Studio para ver el error detallado:
    echo         cd .. ^& npx cap open android
    cd ..
    pause & exit /b 1
)
cd ..

:: Buscar el APK generado
set APK_SRC=android\app\build\outputs\apk\debug\app-debug.apk
if exist "%APK_SRC%" (
    if not exist "dist" mkdir dist
    copy "%APK_SRC%" "dist\SolarTrack-trabajador.apk" >nul
    echo.
    echo ══════════════════════════════════════════════════════
    echo    APK GENERADO EXITOSAMENTE
    echo ══════════════════════════════════════════════════════
    echo.
    echo    Archivo: dist\SolarTrack-trabajador.apk
    echo.
    echo    Como distribuirlo:
    echo    1. Enviar por WhatsApp al trabajador
    echo    2. Compartir por correo electronico
    echo    3. Copiar a USB
    echo.
    echo    El trabajador lo instala asi:
    echo    - Descargar el APK en el movil
    echo    - Ajustes ^> Seguridad ^> Instalar apps desconocidas: Activar
    echo    - Tocar el archivo APK ^> Instalar
    echo ══════════════════════════════════════════════════════
    echo.
    start "" "dist"
) else (
    echo [ERROR] APK no encontrado en la ruta esperada.
)

pause
