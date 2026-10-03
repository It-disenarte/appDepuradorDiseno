// Service worker de la PWA: permite instalarla y abrirla aunque falle la red.
// Al cambiar el diseño, sube la versión para que los equipos descarguen lo nuevo.
const CACHE = 'depurador-v6';
const FUENTES = [300, 400, 500, 600, 700].flatMap((w) => [`fonts/poppins-${w}-latin.woff2`, `fonts/poppins-${w}-latin-ext.woff2`]);
const ARCHIVOS = [
  './', 'index.html', 'styles.css', 'shell.js', 'asistente.js', 'app.js', 'librerias.js', 'rapida.js', 'tecnica.js',
  'manifest.webmanifest?v=3', 'img/icono.svg', 'img/icono-blanco.svg', 'img/textura.jpg',
  'icons/favicon.ico?v=3', 'icons/favicon.svg?v=3', 'icons/apple-touch-icon.png?v=3',
  'icons/icon-192.png?v=3', 'icons/icon-512.png?v=3', 'icons/icon-512-maskable.png?v=3',
  ...FUENTES,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Red primero (para recibir actualizaciones), caché como respaldo. Las llamadas a la API no se guardan.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});
