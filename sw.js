// Guarda la app (no los datos) para que abra al instante y sin señal.
// Subir VERSION en cada cambio de la app, o los teléfonos siguen con la vieja.
const VERSION = 'gastos-v12';
const ARCHIVOS = ['./', 'index.html', 'app.css?v=12', 'app.js?v=12', 'manifest.webmanifest',
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

// --- Avisos (Web Push, 12-11) ---
// El bot manda { titulo, cuerpo, id, tag } cifrado; al tocarlo se abre la app en ese gasto.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titulo: 'Gastos', cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Gasto nuevo', {
    body: d.cuerpo || '', tag: d.tag || undefined, data: { id: d.id || '' },
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png'
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || '';
  const destino = new URL(id ? './?gasto=' + encodeURIComponent(id) : './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ tipo: 'gasto', id }); return w.focus(); }
    return self.clients.openWindow(destino);
  }));
});
