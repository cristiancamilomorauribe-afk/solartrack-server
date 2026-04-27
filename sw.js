/**
 * sw.js — Service Worker SolarTrack
 * Permite uso offline completo de ambas apps
 */
const CACHE_NAME = 'solartrack-v1';

// Recursos que se cachean al instalar
const PRECACHE = [
  '/',
  '/index.html',
  '/worker.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.tailwindcss.com',
];

// Instalar: pre-cachear recursos críticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cachear recursos locales siempre; externos con fallback
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para assets, network-first para API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Peticiones al backend (API) — siempre intentar red
  if (url.port === '8080' || url.pathname.startsWith('/location') || url.pathname.startsWith('/workers')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Tiles del mapa — cache con fallback a red
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME + '-tiles').then(c => c.put(event.request, clone));
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Resto — cache first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'))
    )
  );
});

// Background sync — reenviar ubicaciones pendientes cuando vuelva la red
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-locations') {
    event.waitUntil(syncPendingLocations());
  }
});

async function syncPendingLocations() {
  // Notificar a los clientes abiertos para que ejecuten su lógica de sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_NOW' }));
}
