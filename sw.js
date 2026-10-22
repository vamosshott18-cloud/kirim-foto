// Service worker: simpan aplikasi supaya cepat dibuka & bisa dipasang ke layar utama. Selalu coba versi terbaru dulu.
const CACHE = "kirimfoto-v7";
const FILE = ["./", "index.html", "app.js", "engine.js", "lrpreset.js", "tujuan.js", "config.js", "manifest.webmanifest", "ikon-192.png", "ikon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;     // Google API & CDN langsung ke internet
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: "window" }).then(w => w[0] ? w[0].focus() : self.clients.openWindow("./"))); });
