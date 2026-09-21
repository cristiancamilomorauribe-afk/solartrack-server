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

const db = require('./db');
const { saveKMZFile, listKMZFiles, getKMZFile, deleteKMZFile } = db;
const gh = require('./services/kmz-storage');
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
app.use(express.json({ limit: '60mb' }));   // KMZ pueden ser hasta ~50 MB en base64

// Servir la app maestra desde la carpeta public (Railway) o raíz (local)
const publicDir = path.join(__dirname, 'public');
const rootDir   = path.join(__dirname, '..');
app.use(express.static(publicDir));
app.use(express.static(rootDir));

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

// SOS — alerta de emergencia
app.post('/sos', (req, res) => {
  const data = req.body;
  console.log(`[SOS] 🆘 EMERGENCIA de ${data.workerName} en parque ${data.parkId} — ${data.lat},${data.lng}`);
  // Emitir a todos los supervisores de esa planta
  io.to(`park:${data.parkId}`).emit('sos:alert', { ...data, isSOS: true, ts: new Date().toISOString() });
  // También como location:update para que aparezca el marcador en el mapa
  io.to(`park:${data.parkId}`).emit('location:update', { ...data, isSOS: true });
  db.insertSyncLog('sos', data.parkId, 1, 'alert', `SOS de ${data.workerName}`);
  res.json({ ok: true, received: true });
});

// ─── KMZ FILES ───────────────────────────────────────────────────────────────

// GET /kmz/:parkId — lista de archivos para una planta
app.get('/kmz/:parkId', async (req, res) => {
  try {
    // Si GitHub está habilitado, su lista es la fuente de verdad
    if (gh.enabled()) {
      const files = await gh.ghList(req.params.parkId);
      return res.json(files);
    }
    const files = await listKMZFiles(req.params.parkId);
    res.json(files.map(f => ({ name: f.name, size: f.size, uploadedAt: f.uploadedAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /kmz/:parkId — subir un archivo KMZ (body: { name, data: base64 })
app.post('/kmz/:parkId', async (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: 'name y data requeridos' });
    const buffer = Buffer.from(data, 'base64');
    // Guardar en disco (caché local)
    const saved = await saveKMZFile(req.params.parkId, name, buffer);
    // Subir a GitHub en paralelo (no bloquea la respuesta)
    gh.ghUpload(req.params.parkId, saved.name, buffer).catch(() => {});
    console.log(`[KMZ] Guardado: ${req.params.parkId}/${saved.name} (${(saved.size/1024).toFixed(0)} KB)`);
    res.json({ ok: true, name: saved.name, size: saved.size });
  } catch (err) {
    console.error('[KMZ] Error guardando:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /kmz/:parkId/:name — descargar un archivo KMZ (binario)
app.get('/kmz/:parkId/:name', async (req, res) => {
  try {
    let buffer = null;
    // 1. Disco local (caché rápida)
    try { buffer = await getKMZFile(req.params.parkId, req.params.name); } catch {}
    // 2. GitHub (si el disco lo perdió por reinicio)
    if (!buffer && gh.enabled()) {
      buffer = await gh.ghGet(req.params.parkId, req.params.name);
      if (buffer) {
        // Guardar en caché local para próximas peticiones
        saveKMZFile(req.params.parkId, req.params.name, buffer).catch(() => {});
      }
    }
    if (!buffer) return res.status(404).json({ error: 'Archivo no encontrado' });
    const isKML = req.params.name.toLowerCase().endsWith('.kml');
    res.set('Content-Type',        isKML ? 'application/vnd.google-earth.kml+xml' : 'application/vnd.google-earth.kmz');
    res.set('Content-Disposition', `attachment; filename="${req.params.name}"`);
    res.set('Content-Length',      buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

// DELETE /kmz/:parkId/:name — eliminar un archivo KMZ
app.delete('/kmz/:parkId/:name', async (req, res) => {
  try {
    await deleteKMZFile(req.params.parkId, req.params.name);
    gh.ghDelete(req.params.parkId, req.params.name).catch(() => {});
    console.log(`[KMZ] Eliminado: ${req.params.parkId}/${req.params.name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ─── RESTORE KMZ FROM GITHUB ON STARTUP ─────────────────────
if (gh.enabled()) {
  const KMZ_DIR = require('path').join(__dirname, 'data', 'kmz');
  gh.restoreFromGitHub(KMZ_DIR).catch(e => console.error('[KMZ restore]', e.message));
} else {
  console.log('[KMZ] GITHUB_TOKEN no configurado — persistencia en disco solamente (efímero en Render free)');
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
