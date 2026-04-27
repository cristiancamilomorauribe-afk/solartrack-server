/**
 * download-libs.js
 * Descarga todas las librerías CDN localmente para que el APK funcione sin internet.
 * Ejecutar: node download-libs.js
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const LIBS_DIR = path.join(__dirname, 'libs');
if (!fs.existsSync(LIBS_DIR)) fs.mkdirSync(LIBS_DIR, { recursive: true });

const FILES = [
  // Leaflet
  { url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',        out: 'leaflet.css' },
  { url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',         out: 'leaflet.js' },
  // Chart.js
  { url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', out: 'chart.js' },
  // Socket.io client
  { url: 'https://cdn.socket.io/4.7.4/socket.io.min.js',            out: 'socket.io.js' },
  // QRCode
  { url: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js', out: 'qrcode.js' },
  // Tailwind standalone (versión play CDN incluida en un solo JS)
  { url: 'https://cdn.tailwindcss.com/3.4.1',                        out: 'tailwind.js' },
  // Leaflet images
  { url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',    out: 'images/marker-icon.png' },
  { url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', out: 'images/marker-icon-2x.png' },
  { url: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',  out: 'images/marker-shadow.png' },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    const request = client.get(url, (res) => {
      // Seguir redirecciones
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} para ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
    file.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('Descargando librerías para uso offline en APK...\n');
  for (const f of FILES) {
    const dest = path.join(LIBS_DIR, f.out);
    process.stdout.write(`  ⬇  ${f.out.padEnd(30)}`);
    try {
      await download(f.url, dest);
      const size = (fs.statSync(dest).size / 1024).toFixed(1);
      console.log(`✓  ${size} KB`);
    } catch (err) {
      console.log(`✗  ERROR: ${err.message}`);
    }
  }
  console.log('\n✅ Librerías descargadas en /libs/');
  console.log('   Ahora ejecuta: npm run mobile:android\n');
}

main();
