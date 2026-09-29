// Servidor local para probar antes de subir a Vercel: node servidor.js
// Sirve la carpeta app/ y la función api/revisar.mjs con las variables de .env.local.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = 5173;
const RAIZ = path.join(__dirname, 'app');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
if (fs.existsSync(path.join(__dirname, '.env.local'))) process.loadEnvFile(path.join(__dirname, '.env.local'));
const api = import('./api/revisar.mjs');

async function llamarApi(req, res) {
  const { POST, OPTIONS } = await api;
  const cuerpo = [];
  for await (const trozo of req) cuerpo.push(trozo);
  const peticion = new Request(`http://localhost${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(cuerpo) : undefined,
  });
  const resp = await (req.method === 'POST' ? POST(peticion) : OPTIONS(peticion));
  res.writeHead(resp.status, Object.fromEntries(resp.headers));
  res.end(Buffer.from(await resp.arrayBuffer()));
}

http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === '/api/revisar') {
    llamarApi(req, res).catch((e) => { res.writeHead(500).end(JSON.stringify({ error: { message: e.message } })); });
    return;
  }
  const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404).end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(datos);
  });
}).listen(PUERTO, 'localhost', () => console.log(`Depurador listo en http://localhost:${PUERTO}`));
