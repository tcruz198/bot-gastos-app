// Guarda la app (no los datos) para que abra al instante y sin señal.
// Subir VERSION en cada cambio de la app, o los teléfonos siguen con la vieja.
const VERSION = 'gastos-v11';
const ARCHIVOS = ['./', 'index.html', 'app.css?v=11', 'app.js?v=11', 'manifest.webmanifest',
                  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Solo los archivos propios: la API de Google va siempre directo a la red.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    // no-cache: siempre pregunta al servidor si hay versión nueva. Sin esto el
    // teléfono mezcló un index.html viejo con un app.js nuevo y quedó en negro (04-11).
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
