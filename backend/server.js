/**
 * server.js — Servidor principal SolarTrack (Maestro)
 *
 * Puerto por defecto : 8080
 * Escucha en         : 0.0.0.0 (toda la red local WiFi del parque)
 *
 * Instalar y arrancar:
 *   cd backend && npm install && npm start
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

const db                   = require('./db');
const locationRoutes       = require('./routes/locations');
const workerRoutes         = require('./routes/workers');
const { startAutoSync, getSyncStatus } = require('./sync/firebase');

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const PORT    = process.env.PORT || 8080;
const HOST    = '0.0.0.0';   // acepta conexiones del WiFi local
const app     = express();
const server  = http.createServer(app);

// ─── SOCKET.IO ───────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

app.set('io', io);

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Servir la app maestra desde la raíz del proyecto
app.use(express.static(path.join(__dirname, '..')));

// ─── RUTAS REST ──────────────────────────────────────────────

// Ping — usado por esclavos para saber si el maestro está accesible
app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), server: 'SolarTrack-Maestro' });
});

// Ubicaciones
app.use('/location',  locationRoutes);   // POST /location  → router.post('/')
app.use('/locations', locationRoutes);   // GET  /locations/worker/:id | /park/:id
                                         // POST /locations/batch

// Alias batch para apps esclavas (POST /batch-locations)
app.post('/batch-locations', (req, res, next) => {
  req.url = '/batch';
  locationRoutes(req, res, next);
});

// Trabajadores
app.use('/workers', workerRoutes);

// Parques
app.get('/parks', (req, res) => {
  db.db.parks.find({}).sort({ id: 1 }).exec(
    (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
  );
});

// Resumen del día (todos los parques)
app.get('/dashboard', async (req, res) => {
  try {
    const [stats, recent] = await Promise.all([db.getTodayStats(), db.getRecentSyncLog()]);
    res.json({ stats, sync: getSyncStatus(), recentSync: recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log de sincronización
app.get('/sync-log', async (req, res) => {
  try {
    res.json(await db.getRecentSyncLog());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SOCKET.IO EVENTS ────────────────────────────────────────
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[WS] Cliente conectado: ${socket.id} desde ${clientIp}`);

  // La app maestra se suscribe a uno o varios parques
  socket.on('join:park', (parkId) => {
    socket.join(`park:${parkId}`);
    console.log(`[WS] ${socket.id} se unió al parque ${parkId}`);

    // Enviar snapshot actual de trabajadores
    db.getWorkersByPark(parkId)
      .then(workers => socket.emit('park:snapshot', { parkId, workers }))
      .catch(err => console.error('[WS] Error snapshot:', err.message));
  });

  socket.on('leave:park', (parkId) => {
    socket.leave(`park:${parkId}`);
  });

  // Worker esclavo reporta ubicación via WebSocket (alternativa a HTTP POST)
  socket.on('worker:location', (data) => {
    db.insertLocation(data)
      .then(() => socket.to(`park:${data.parkId}`).emit('location:update', data))
      .catch(err => console.error('[WS] Error insertando ubicación:', err.message));
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Desconectado: ${socket.id}`);
  });
});

// ─── HEARTBEAT — marca offline a trabajadores inactivos ──────
setInterval(async () => {
  try {
    const count = await db.markWorkersOffline();
    if (count > 0) {
      io.emit('workers:status-change', { offlineCount: count });
      console.log(`[Heartbeat] ${count} trabajadores marcados offline`);
    }
  } catch (err) {
    console.error('[Heartbeat]', err.message);
  }
}, 60 * 1000);

// ─── FIREBASE AUTO-SYNC ──────────────────────────────────────
// Solo si la variable de entorno FIREBASE_URL está configurada
if (process.env.FIREBASE_URL) {
  startAutoSync();
} else {
  console.log('[Firebase] FIREBASE_URL no configurado — sync en la nube deshabilitado');
  console.log('[Firebase] Para activar: set FIREBASE_URL=https://tu-proyecto.firebaseio.com');
}

// ─── START ───────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIp = 'localhost';

  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  🌞  SolarTrack — Servidor Maestro');
  console.log('══════════════════════════════════════════════');
  console.log(`  Local:       http://localhost:${PORT}`);
  console.log(`  Red WiFi:    http://${localIp}:${PORT}  ← IP para los esclavos`);
  console.log(`  App Maestra: http://${localIp}:${PORT}/index.html`);
  console.log(`  App Esclava: http://${localIp}:${PORT}/worker.html`);
  console.log('══════════════════════════════════════════════\n');
});

module.exports = { app, server, io };
