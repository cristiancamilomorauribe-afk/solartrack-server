# Instalar Android Studio — Guía rápida

## Paso 1 — Descargar Android Studio

1. Ve a: https://developer.android.com/studio
2. Clic en **"Download Android Studio"**
3. Acepta los términos y descarga (el instalador pesa ~1 GB)

## Paso 2 — Instalar

1. Ejecuta el instalador descargado
2. Deja todo por defecto y haz clic en **Next** hasta terminar
3. Al final marca **"Start Android Studio"** y haz clic en **Finish**

## Paso 3 — Configuración inicial (solo una vez)

1. Android Studio se abre → Selecciona **"Standard"** → Next
2. Acepta todas las licencias → Finish
3. **Espera** que descargue el Android SDK (~2-3 GB, puede tardar 10-20 min)

## Paso 4 — Generar el APK

Una vez instalado Android Studio, **ciérralo** y ejecuta:

```
build-apk.bat
```

El script hace todo automáticamente y al final abre la carpeta `dist/` con el APK listo.

## Paso 5 — Distribuir a los trabajadores

El archivo `dist/SolarTrack-trabajador.apk` lo puedes:
- Enviar por **WhatsApp**
- Enviar por **correo electrónico**
- Copiar con **USB**

### El trabajador lo instala así:
1. Recibe el APK en el móvil
2. Va a **Ajustes → Seguridad → Instalar apps desconocidas** → Activar para Chrome/WhatsApp
3. Toca el archivo APK → **Instalar**
4. La app aparece en el menú como cualquier otra app

## Tiempo estimado total
- Instalación Android Studio: 20-30 min (descarga + configuración)
- Generación del APK: 3-5 min (solo la primera vez tarda más)
