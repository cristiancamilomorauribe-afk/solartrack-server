# SolarTrack — Guía de instalación y despliegue

## Estructura del proyecto

```
solar-park-tracker/
├── index.html          ← App Maestra (navegador / tablet del supervisor)
├── worker.html         ← App Esclava (móvil del trabajador)
├── background.js       ← Tarea GPS en segundo plano (móvil)
├── capacitor.config.json
├── package.json        ← Scripts de empaquetado móvil
└── backend/
    ├── server.js       ← Servidor Node.js (corre en el dispositivo maestro)
    ├── db.js           ← Base de datos SQLite
    ├── routes/
    │   ├── locations.js
    │   └── workers.js
    └── sync/
        └── firebase.js ← Sync opcional a la nube
```

---

## 1. Prerrequisitos

- Node.js 18+ → https://nodejs.org
- Android Studio (para empaquetar Android)
- Xcode (para empaquetar iOS — solo en Mac)

---

## 2. Arrancar el backend (servidor maestro)

```bash
cd backend
npm install
npm start
```

Al iniciar verás la IP WiFi local, por ejemplo:
```
  Red WiFi:  http://192.168.1.105:8080  ← esta IP van los esclavos
```

---

## 3. Acceder a las apps en el navegador

| App | URL |
|-----|-----|
| Maestra | http://192.168.1.105:8080/index.html |
| Esclava | http://192.168.1.105:8080/worker.html |

Los trabajadores abren `worker.html` en su móvil usando la IP del maestro como URL.

---

## 4. Empaquetar como app móvil (Android + iOS)

### Instalar dependencias
```bash
npm install
```

### Android
```bash
npm run mobile:android
```
Esto abre Android Studio → Build → Generate Signed APK

### iOS (solo en Mac)
```bash
npm run mobile:ios
```
Esto abre Xcode → Product → Archive

---

## 5. Configurar Firebase (opcional — para sync en la nube)

1. Crea un proyecto en https://console.firebase.google.com
2. Activa **Realtime Database**
3. Copia la URL del proyecto (ej: `https://mi-proyecto-default-rtdb.firebaseio.com`)
4. En `backend/`:
   ```bash
   cp .env.example .env
   # Edita .env y añade tu FIREBASE_URL
   ```
5. Reinicia el backend → sincronización automática cada 2 minutos

---

## 6. Permisos necesarios en el móvil (worker.html / APK)

- **GPS en segundo plano** — para seguimiento aunque la app esté minimizada
- **Red local WiFi** — para comunicarse con el maestro sin internet
- **Notificaciones** — para recibir alertas del supervisor

---

## 7. Flujo offline completo

```
Trabajador sin internet
        ↓
GPS guarda en IndexedDB (navegador) o SQLite (APK)
        ↓
WiFi del parque restaurada
        ↓
App detecta maestro en 192.168.x.x:8080
        ↓
Envía batch de todos los puntos guardados
        ↓
Maestro guarda en SQLite local
        ↓
Internet disponible
        ↓
Backend sube a Firebase (nube) cada 2 minutos
```
