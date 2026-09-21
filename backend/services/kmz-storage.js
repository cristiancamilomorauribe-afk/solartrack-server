/**
 * kmz-storage.js — Almacenamiento persistente de KMZ via GitHub Releases
 *
 * Si GITHUB_TOKEN está configurado: usa GitHub Releases como backend primario
 * (persistente, sobrevive reinicios de Render). El disco local actúa como caché.
 * Si no está configurado: usa solo disco (comportamiento anterior, efímero).
 *
 * Configuración en Render:
 *   GITHUB_TOKEN = ghp_xxxxxxxxxxxxxxxxxxxx  (PAT con scope: repo)
 */

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

const TOKEN        = process.env.GITHUB_TOKEN;
const OWNER        = 'cristiancamilomorauribe-afk';
const REPO         = 'solartrack-server';
const RELEASE_TAG  = 'kmz-data-v1';
const RELEASE_NAME = 'KMZ Data Storage';

let _releaseId   = null;   // caché del release id
let _assetsCache = null;   // caché de la lista de assets

// ─── HTTP helpers ──────────────────────────────────────────────────────────

function apiReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? (body instanceof Buffer ? body : Buffer.from(JSON.stringify(body))) : null;
    const isUpload = path.includes('uploads.github.com');
    const hostname = isUpload ? 'uploads.github.com' : 'api.github.com';
    const reqPath  = isUpload ? path : path;

    const opts = {
      hostname,
      path: isUpload ? reqPath : (reqPath.startsWith('/') ? reqPath : '/' + reqPath),
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent':    'SolarTrack-KMZ/1.0',
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    if (data) {
      opts.headers['Content-Type']   = body instanceof Buffer ? 'application/octet-stream' : 'application/json';
      opts.headers['Content-Length'] = data.length;
    }

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 204) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`GitHub ${res.statusCode}: ${txt.slice(0,300)}`));
        try { resolve(JSON.parse(txt)); } catch { resolve(txt); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Sigue redireccionamientos hasta obtener el buffer binario
function downloadBinary(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      const parsed = new URL(u);
      const mod    = parsed.protocol === 'https:' ? https : http;
      const opts   = {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers: {
          'User-Agent':    'SolarTrack-KMZ/1.0',
          'Authorization': `Bearer ${TOKEN}`,
          'Accept':        'application/octet-stream',
        },
      };
      mod.request(opts, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return get(res.headers.location);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject).end();
    };
    get(url);
  });
}

// ─── Release management ────────────────────────────────────────────────────

async function getRelease() {
  if (_releaseId) return _releaseId;
  try {
    const r = await apiReq('GET', `/repos/${OWNER}/${REPO}/releases/tags/${RELEASE_TAG}`);
    _releaseId = r.id;
  } catch {
    const r = await apiReq('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name:   RELEASE_TAG,
      name:       RELEASE_NAME,
      body:       'Internal storage for SolarTrack KMZ map overlay files.',
      draft:      false,
      prerelease: true,
    });
    _releaseId = r.id;
  }
  return _releaseId;
}

async function getAssets() {
  if (_assetsCache) return _assetsCache;
  const id     = await getRelease();
  const assets = await apiReq('GET', `/repos/${OWNER}/${REPO}/releases/${id}/assets?per_page=100`);
  _assetsCache = Array.isArray(assets) ? assets : [];
  return _assetsCache;
}

function invalidateCache() { _assetsCache = null; }

// Asset name format: "PARKID__filename.kmz"
function assetName(parkId, name) {
  return `${parkId}__${name.replace(/[^a-zA-Z0-9._\-]/g, '_')}`;
}
function parseAsset(asset) {
  const sep = asset.name.indexOf('__');
  if (sep < 0) return null;
  return { parkId: asset.name.slice(0, sep), name: asset.name.slice(sep + 2), id: asset.id, size: asset.size };
}

// ─── Public API ────────────────────────────────────────────────────────────

async function ghUpload(parkId, name, buffer) {
  if (!TOKEN) return;
  try {
    // Eliminar asset existente con el mismo nombre antes de subir
    await ghDelete(parkId, name);
    const id  = await getRelease();
    const aName = assetName(parkId, name.replace(/[^a-zA-Z0-9._\-]/g, '_'));
    await apiReq(
      'POST',
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${id}/assets?name=${encodeURIComponent(aName)}`,
      buffer
    );
    invalidateCache();
    console.log(`[KMZ-GH] ✅ ${parkId}/${name} (${(buffer.length/1024).toFixed(0)} KB)`);
  } catch(e) {
    console.error('[KMZ-GH] upload error:', e.message);
  }
}

async function ghList(parkId) {
  if (!TOKEN) return [];
  try {
    const assets = await getAssets();
    return assets
      .map(parseAsset)
      .filter(a => a && a.parkId === parkId)
      .map(a => ({ name: a.name, size: a.size }));
  } catch(e) {
    console.error('[KMZ-GH] list error:', e.message);
    return [];
  }
}

async function ghGet(parkId, name) {
  if (!TOKEN) return null;
  try {
    const safeName = name.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const assets   = await getAssets();
    const target   = assetName(parkId, safeName);
    const asset    = assets.find(a => a.name === target);
    if (!asset) return null;
    // Descarga con autenticación (funciona en repos privados y públicos)
    return await downloadBinary(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`
    );
  } catch(e) {
    console.error('[KMZ-GH] get error:', e.message);
    return null;
  }
}

async function ghDelete(parkId, name) {
  if (!TOKEN) return;
  try {
    const safeName = name.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const assets   = _assetsCache || await getAssets();
    const target   = assetName(parkId, safeName);
    const asset    = assets.find(a => a.name === target);
    if (!asset) return;
    await apiReq('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`);
    invalidateCache();
    console.log(`[KMZ-GH] 🗑 ${parkId}/${name}`);
  } catch(e) {
    console.error('[KMZ-GH] delete error:', e.message);
  }
}

/**
 * Al arrancar el servidor: descarga los KMZ de GitHub al disco local (caché).
 * Solo se llama una vez al inicio.
 */
async function restoreFromGitHub(kmzDir) {
  if (!TOKEN) return;
  try {
    const assets = await getAssets();
    const kmzAssets = assets.map(parseAsset).filter(Boolean);
    if (!kmzAssets.length) return;

    console.log(`[KMZ-GH] Restaurando ${kmzAssets.length} archivo(s) desde GitHub...`);
    for (const { parkId, name, id } of kmzAssets) {
      const parkDir  = path.join(kmzDir, parkId);
      const filePath = path.join(parkDir, name);
      if (fs.existsSync(filePath)) continue; // ya en caché
      if (!fs.existsSync(parkDir)) fs.mkdirSync(parkDir, { recursive: true });
      try {
        const buf = await downloadBinary(
          `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${id}`
        );
        fs.writeFileSync(filePath, buf);
        console.log(`[KMZ-GH] ✅ Restaurado ${parkId}/${name}`);
      } catch(e) {
        console.warn(`[KMZ-GH] ⚠ No se pudo restaurar ${parkId}/${name}:`, e.message);
      }
    }
  } catch(e) {
    console.error('[KMZ-GH] restoreFromGitHub error:', e.message);
  }
}

module.exports = { ghUpload, ghList, ghGet, ghDelete, restoreFromGitHub, enabled: () => !!TOKEN };
