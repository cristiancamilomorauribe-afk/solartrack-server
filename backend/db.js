/**
 * db.js — Base de datos local del maestro (NeDB — puro JavaScript)
 * Los datos se guardan en archivos .db dentro de /backend/data/
 */
const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ─── COLECCIONES ─────────────────────────────────────────────
const db = {
  workers:   new Datastore({ filename: path.join(DATA_DIR, 'workers.db'),   autoload: true }),
  locations: new Datastore({ filename: path.join(DATA_DIR, 'locations.db'), autoload: true }),
  parks:     new Datastore({ filename: path.join(DATA_DIR, 'parks.db'),     autoload: true }),
  syncLog:   new Datastore({ filename: path.join(DATA_DIR, 'synclog.db'),   autoload: true }),
};

// Índices para consultas rápidas
db.workers.ensureIndex({ fieldName: 'id', unique: true });
db.locations.ensureIndex({ fieldName: 'workerId' });
db.locations.ensureIndex({ fieldName: 'parkId' });
db.locations.ensureIndex({ fieldName: 'date' });
db.locations.ensureIndex({ fieldName: 'syncedCloud' });
db.parks.ensureIndex({ fieldName: 'id', unique: true });

// ─── SEED — parques iniciales ────────────────────────────────
const PARKS = [
  { id:'P1', name:'Parque Solar 1 — Sevilla Norte',  centerLat:37.45, centerLng:-5.98 },
  { id:'P2', name:'Parque Solar 2 — Sevilla Sur',    centerLat:37.28, centerLng:-6.02 },
  { id:'P3', name:'Parque Solar 3 — Cádiz Este',     centerLat:36.52, centerLng:-6.28 },
  { id:'P4', name:'Parque Solar 4 — Huelva',         centerLat:37.26, centerLng:-6.95 },
  { id:'P5', name:'Parque Solar 5 — Córdoba',        centerLat:37.88, centerLng:-4.78 },
  { id:'P6', name:'Parque Solar 6 — Málaga',         centerLat:36.72, centerLng:-4.42 },
  { id:'P7', name:'Parque Solar 7 — Almería',        centerLat:36.84, centerLng:-2.46 },
];

PARKS.forEach(park => {
  db.parks.findOne({ id: park.id }, (err, doc) => {
    if (!doc) db.parks.insert(park);
  });
});

// ─── HELPERS ─────────────────────────────────────────────────

/**
 * Inserta un punto de ubicación y actualiza el worker
 */
function insertLocation(record) {
  return new Promise((resolve, reject) => {
    const date = record.ts ? record.ts.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const locDoc = {
      workerId:    record.workerId,
      workerName:  record.workerName || 'Desconocido',
      parkId:      record.parkId,
      zoneId:      record.zoneId || null,
      zoneName:    record.zoneName || null,
      lat:         record.lat,
      lng:         record.lng,
      accuracy:    record.accuracy || null,
      ts:          record.ts || new Date().toISOString(),
      date,
      battery:     record.battery || null,
      syncedCloud: false,
      receivedAt:  new Date().toISOString(),
    };

    db.locations.insert(locDoc, (err, newDoc) => {
      if (err) return reject(err);

      // Actualizar o crear el worker
      const workerDoc = {
        id:       record.workerId,
        name:     record.workerName || 'Desconocido',
        parkId:   record.parkId,
        zoneId:   record.zoneId || '',
        zoneName: record.zoneName || '',
        status:   'online',
        lastLat:  record.lat,
        lastLng:  record.lng,
        lastSeen: record.ts || new Date().toISOString(),
        battery:  record.battery || null,
      };

      db.workers.update(
        { id: record.workerId },
        { $set: workerDoc },
        { upsert: true },
        (err2) => { if (err2) return reject(err2); resolve(newDoc); }
      );
    });
  });
}

/**
 * Inserta un lote de ubicaciones (sync offline)
 */
function insertBatch(workerId, parkId, locations) {
  return new Promise((resolve, reject) => {
    const docs = locations.map(loc => ({
      workerId,
      workerName:  loc.workerName || 'Desconocido',
      parkId,
      zoneId:      loc.zoneId || null,
      zoneName:    loc.zoneName || null,
      lat:         loc.lat,
      lng:         loc.lng,
      accuracy:    loc.accuracy || null,
      ts:          loc.ts || new Date().toISOString(),
      date:        loc.ts ? loc.ts.slice(0, 10) : new Date().toISOString().slice(0, 10),
      battery:     loc.battery || null,
      syncedCloud: false,
      receivedAt:  new Date().toISOString(),
    }));

    db.locations.insert(docs, (err, newDocs) => {
      if (err) return reject(err);

      // Actualizar el worker con el último punto
      if (locations.length > 0) {
        const last = locations[locations.length - 1];
        db.workers.update(
          { id: workerId },
          { $set: {
            id: workerId,
            name:     last.workerName || 'Desconocido',
            parkId,
            zoneId:   last.zoneId || '',
            zoneName: last.zoneName || '',
            status:   'online',
            lastLat:  last.lat,
            lastLng:  last.lng,
            lastSeen: last.ts,
            battery:  last.battery || null,
          }},
          { upsert: true },
          () => resolve(newDocs.length)
        );
      } else {
        resolve(0);
      }
    });
  });
}

// ─── QUERIES ─────────────────────────────────────────────────

function getWorkersByPark(parkId) {
  return new Promise((resolve, reject) => {
    db.workers.find({ parkId }, (err, docs) => err ? reject(err) : resolve(docs));
  });
}

function getAllWorkers() {
  return new Promise((resolve, reject) => {
    db.workers.find({}, (err, docs) => err ? reject(err) : resolve(docs));
  });
}

function getWorkerById(id) {
  return new Promise((resolve, reject) => {
    db.workers.findOne({ id }, (err, doc) => err ? reject(err) : resolve(doc));
  });
}

function getLocationsByWorkerDate(workerId, date) {
  return new Promise((resolve, reject) => {
    db.locations.find({ workerId, date }).sort({ ts: 1 }).exec(
      (err, docs) => err ? reject(err) : resolve(docs)
    );
  });
}

function getLocationsByParkDate(parkId, date) {
  return new Promise((resolve, reject) => {
    db.locations.find({ parkId, date }).sort({ ts: 1 }).exec(
      (err, docs) => err ? reject(err) : resolve(docs)
    );
  });
}

function getLocationsByWorkerRange(workerId, from, to) {
  return new Promise((resolve, reject) => {
    db.locations.find({ workerId, date: { $gte: from, $lte: to } })
      .sort({ date: -1 }).exec((err, docs) => {
        if (err) return reject(err);
        // Agrupar por fecha
        const grouped = {};
        docs.forEach(d => {
          if (!grouped[d.date]) grouped[d.date] = { date: d.date, count: 0, firstTs: d.ts, lastTs: d.ts };
          grouped[d.date].count++;
          if (d.ts < grouped[d.date].firstTs) grouped[d.date].firstTs = d.ts;
          if (d.ts > grouped[d.date].lastTs)  grouped[d.date].lastTs  = d.ts;
        });
        resolve(Object.values(grouped).sort((a,b) => b.date.localeCompare(a.date)));
      });
  });
}

function getPendingCloudSync(limit = 500) {
  return new Promise((resolve, reject) => {
    db.locations.find({ syncedCloud: false }).limit(limit).exec(
      (err, docs) => err ? reject(err) : resolve(docs)
    );
  });
}

function markCloudSynced(ids) {
  return new Promise((resolve, reject) => {
    db.locations.update(
      { _id: { $in: ids } },
      { $set: { syncedCloud: true } },
      { multi: true },
      (err) => err ? reject(err) : resolve()
    );
  });
}

function getTodayStats() {
  return new Promise((resolve, reject) => {
    const today = new Date().toISOString().slice(0, 10);
    db.workers.find({}, async (err, workers) => {
      if (err) return reject(err);

      const byPark = {};
      workers.forEach(w => {
        if (!byPark[w.parkId]) byPark[w.parkId] = { parkId: w.parkId, total:0, online:0, offline:0, pending:0 };
        byPark[w.parkId].total++;
        byPark[w.parkId][w.status]++;
      });

      // Contar puntos de hoy por parque
      db.locations.find({ date: today }, (err2, locs) => {
        if (!err2) {
          locs.forEach(l => {
            if (byPark[l.parkId]) byPark[l.parkId].pointsToday = (byPark[l.parkId].pointsToday || 0) + 1;
          });
        }
        resolve(Object.values(byPark));
      });
    });
  });
}

function insertSyncLog(direction, parkId, count, status, detail) {
  db.syncLog.insert({ direction, parkId, count, status, detail, createdAt: new Date().toISOString() });
}

function getRecentSyncLog(limit = 50) {
  return new Promise((resolve, reject) => {
    db.syncLog.find({}).sort({ createdAt: -1 }).limit(limit).exec(
      (err, docs) => err ? reject(err) : resolve(docs)
    );
  });
}

function markWorkersOffline() {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return new Promise((resolve) => {
    db.workers.update(
      { status: 'online', lastSeen: { $lt: cutoff } },
      { $set: { status: 'offline' } },
      { multi: true },
      (err, count) => resolve(count || 0)
    );
  });
}

module.exports = {
  db,
  insertLocation,
  insertBatch,
  getWorkersByPark,
  getAllWorkers,
  getWorkerById,
  getLocationsByWorkerDate,
  getLocationsByParkDate,
  getLocationsByWorkerRange,
  getPendingCloudSync,
  markCloudSynced,
  getTodayStats,
  insertSyncLog,
  getRecentSyncLog,
  markWorkersOffline,
};
