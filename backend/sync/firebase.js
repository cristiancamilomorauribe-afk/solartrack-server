const fetch = require('node-fetch');
const db    = require('../db');

const FIREBASE_URL    = process.env.FIREBASE_URL    || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET || '';

let syncRunning = false;
let lastSyncAt  = null;

async function syncToCloud() {
  if (syncRunning || !FIREBASE_URL) return;
  syncRunning = true;

  try {
    const pending = await db.getPendingCloudSync(500);
    if (pending.length === 0) { syncRunning = false; return; }

    console.log(`[Firebase] Subiendo ${pending.length} puntos...`);

    const byPark = {};
    pending.forEach(loc => {
      if (!byPark[loc.parkId]) byPark[loc.parkId] = {};
      byPark[loc.parkId][loc._id] = { workerId: loc.workerId, lat: loc.lat, lng: loc.lng, ts: loc.ts, date: loc.date };
    });

    const results = await Promise.allSettled(
      Object.entries(byPark).map(([parkId, locs]) =>
        fetch(`${FIREBASE_URL}/locations/${parkId}.json${FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : ''}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(locs),
        })
      )
    );

    if (results.every(r => r.status === 'fulfilled')) {
      await db.markCloudSynced(pending.map(p => p._id));
      lastSyncAt = new Date().toISOString();
      db.insertSyncLog('to_cloud', 'ALL', pending.length, 'ok', `${pending.length} pts`);
      console.log(`[Firebase] ✓ ${pending.length} puntos sincronizados`);
    }
  } catch (err) {
    console.error('[Firebase]', err.message);
  } finally {
    syncRunning = false;
  }
}

function startAutoSync(intervalMs = 2 * 60 * 1000) {
  if (!FIREBASE_URL) return;
  console.log('[Firebase] Auto-sync activo cada', intervalMs / 60000, 'min');
  syncToCloud();
  setInterval(syncToCloud, intervalMs);
}

function getSyncStatus() {
  return { lastSyncAt, running: syncRunning, configured: !!FIREBASE_URL };
}

module.exports = { syncToCloud, startAutoSync, getSyncStatus };
