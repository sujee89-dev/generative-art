// Offline support: keeps a copy of the app on the device.
// Bump VERSION whenever any file changes so devices pick up the new copy.
const VERSION = "ahara-v2";
const FILES = [
  "./", "index.html", "android-tts.js", "app.js", "world.js", "chess.js", "manifest.webmanifest",
  "data/words.js", "data/books-en.js", "data/books-fr.js", "data/books-ta.js", "data/world.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Fonts: use the saved copy, refresh it in the background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(caches.open(VERSION + "-fonts").then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // App files: try the network first so updates arrive, fall back to the saved copy offline.
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(cache => cache.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("index.html")))
  );
});
