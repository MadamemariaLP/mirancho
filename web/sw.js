// App shell en caché; los datos van primero a red y, sin conexión, a la última copia.
const CACHE = "mirancho-v9";
const SHELL = ["./", "index.html", "styles.css", "geo.js", "app.js", "detail.js", "notes.js", "share.js", "portals.js", "icon.svg", "apple-touch-icon.png", "icon-192.png", "manifest.webmanifest",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.hostname.includes("tile.openstreetmap")) return;
  const networkFirst = url.pathname.includes("/data/") || url.origin === location.origin;
  if (networkFirst) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request)));
  }
});
