const express = require('express');
const router  = express.Router();
const db = require('../db');

// POST /location — un punto en tiempo real
router.post('/', async (req, res) => {
  try {
    const record = req.body;
    if (!record.lat || !record.lng || !record.workerId || !record.parkId) {
      return res.status(400).json({ error: 'Faltan campos: lat, lng, workerId, parkId' });
    }

    await db.insertLocation(record);

    const io = req.app.get('io');
    if (io) {
      io.to(`park:${record.parkId}`).emit('location:update', {
        workerId:   record.workerId,
        workerName: record.workerName,
        parkId:     record.parkId,
        zoneId:     record.zoneId,
        lat:        record.lat,
        lng:        record.lng,
        accuracy:   record.accuracy,
        battery:    record.battery,
        ts:         record.ts || new Date().toISOString(),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[location]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /batch — lote offline
router.post('/batch', async (req, res) => {
  try {
    const { workerId, parkId, locations } = req.body;
    if (!workerId || !parkId || !Array.isArray(locations)) {
      return res.status(400).json({ error: 'Formato: {workerId, parkId, locations:[]}' });
    }

    const count = await db.insertBatch(workerId, parkId, locations);
    db.insertSyncLog('from_slave', parkId, count, 'ok', `Worker ${workerId} sync ${count} pts`);

    const io = req.app.get('io');
    if (io && locations.length > 0) {
      const last = locations[locations.length - 1];
      // Emitir location:update con la última posición conocida
      io.to(`park:${parkId}`).emit('location:update', {
        workerId,
        workerName: last.workerName || workerId,
        parkId,
        zoneId:   last.zoneId || '',
        zoneName: last.zoneName || '',
        lat:      last.lat,
        lng:      last.lng,
        accuracy: last.accuracy || 0,
        ts:       last.ts || new Date().toISOString(),
        synced:   true,
      });
      io.to(`park:${parkId}`).emit('worker:batch-sync', { workerId, parkId, count, lastLat: last.lat, lastLng: last.lng, lastTs: last.ts });
    }

    res.json({ ok: true, inserted: count });
  } catch (err) {
    console.error('[batch]', err.message);
    db.insertSyncLog('from_slave', req.body?.parkId, 0, 'error', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /locations/worker/:id?date=YYYY-MM-DD  o  ?from=&to=
router.get('/worker/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, from, to } = req.query;
    let rows;
    if (from && to) {
      rows = await db.getLocationsByWorkerRange(id, from, to);
    } else {
      rows = await db.getLocationsByWorkerDate(id, date || new Date().toISOString().slice(0, 10));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /locations/park/:id?date=YYYY-MM-DD
router.get('/park/:id', async (req, res) => {
  try {
    const rows = await db.getLocationsByParkDate(
      req.params.id,
      req.query.date || new Date().toISOString().slice(0, 10)
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
