// Servidor del Depurador para la VPS (Easypanel) y para probar en tu equipo: node server.js
// Sirve la app (carpeta app/) y la API (api/revisar.mjs), sin dependencias extra.
// Variables: GEMINI_API_KEY, CODIGO_EQUIPO y, opcional, PORT (3000). En local se leen de .env.local o .env.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

for (const f of ['.env.local', '.env']) {
  const ruta = path.join(__dirname, f);
  if (fs.existsSync(ruta)) process.loadEnvFile(ruta);
}

const PUERTO = Number(process.env.PORT || 3000);
const RAIZ = path.join(__dirname, 'app');
const LIMITE_CUERPO = 26 * 1024 * 1024; // 18 MB de archivos en base64 + instrucciones
const LIMITE_API_MS = 120_000; // el modelo Pro puede tardar con PDF grandes

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.aff': 'text/plain; charset=utf-8', '.dic': 'text/plain; charset=utf-8',
  '.traineddata': 'application/octet-stream',
};
// Se comprimen al vuelo los de texto (las librerías de vendor/ bajan de ~20 MB a ~8 MB).
const COMPRIMIBLES = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.aff', '.dic', '.traineddata']);

const api = import('./api/revisar.mjs');

// ---------- API ----------
async function llamarApi(req, res) {
  if (!['POST', 'OPTIONS'].includes(req.method)) return responder(res, 405, { error: { message: 'Método no permitido.' } });
  const { POST, OPTIONS } = await api;
  if (req.method === 'OPTIONS') return enviar(res, await OPTIONS());

  const trozos = [];
  let tamano = 0;
  for await (const trozo of req) {
    tamano += trozo.length;
    if (tamano > LIMITE_CUERPO) {
      return responder(res, 413, { error: { message: 'Los archivos pesan demasiado. El máximo es 18 MB por revisión.' } });
    }
    trozos.push(trozo);
  }
  const peticion = new Request(`http://localhost${req.url}`, { method: 'POST', headers: req.headers, body: Buffer.concat(trozos) });
  enviar(res, await POST(peticion));
}

async function enviar(res, resp) {
  res.writeHead(resp.status, Object.fromEntries(resp.headers));
  res.end(Buffer.from(await resp.arrayBuffer()));
}

function responder(res, status, json) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(json));
}

// ---------- Archivos de la app ----------
function estatico(req, res, ruta) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  // Nada fuera de app/ ni archivos ocultos
  if (!archivo.startsWith(RAIZ + path.sep) || path.basename(archivo).startsWith('.')) { res.writeHead(404).end('No encontrado'); return; }
  const ext = path.extname(archivo).toLowerCase();
  fs.stat(archivo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('No encontrado'); return; }
    const nombre = path.relative(RAIZ, archivo).replaceAll('\\', '/');
    const cabeceras = {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      // La app y el service worker se revisan siempre; las librerías casi nunca cambian.
      'Cache-Control': ['index.html', 'sw.js', 'manifest.webmanifest'].includes(nombre) ? 'no-cache'
        : nombre.startsWith('vendor/') || nombre.startsWith('fonts/') ? 'public, max-age=604800' : 'public, max-age=3600',
      'Last-Modified': st.mtime.toUTCString(),
    };
    if (nombre === 'sw.js') cabeceras['Service-Worker-Allowed'] = '/';
    if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
      res.writeHead(304, cabeceras).end();
      return;
    }
    const gzip = COMPRIMIBLES.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && st.size > 1024;
    if (gzip) { cabeceras['Content-Encoding'] = 'gzip'; cabeceras.Vary = 'Accept-Encoding'; } else cabeceras['Content-Length'] = st.size;
    res.writeHead(200, cabeceras);
    if (req.method === 'HEAD') { res.end(); return; }
    const flujo = fs.createReadStream(archivo);
    (gzip ? flujo.pipe(zlib.createGzip({ level: 6 })) : flujo).pipe(res);
  });
}

const servidor = http.createServer((req, res) => {
  let ruta;
  try { ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }

  if (ruta === '/api/salud') {
    const { GEMINI_API_KEY, CODIGO_EQUIPO } = process.env;
    return responder(res, GEMINI_API_KEY && CODIGO_EQUIPO ? 200 : 500,
      { ok: !!(GEMINI_API_KEY && CODIGO_EQUIPO), gemini: !!GEMINI_API_KEY, codigo: !!CODIGO_EQUIPO });
  }
  if (ruta === '/api/revisar') {
    res.setTimeout(LIMITE_API_MS, () => responder(res, 504, { error: { message: 'La revisión tardó demasiado. Intenta de nuevo o con menos archivos.' } }));
    llamarApi(req, res).catch((e) => { console.error(e); responder(res, 500, { error: { message: 'Error del servidor.' } }); });
    return;
  }
  estatico(req, res, ruta);
});

servidor.listen(PUERTO, () => console.log(`Depurador escuchando en http://localhost:${PUERTO}`));

// Easypanel manda SIGTERM al redesplegar: termina las revisiones en curso y sale.
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => {
  console.log(`${s}: cerrando…`);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
