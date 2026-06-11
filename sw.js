// Service worker: app shell cache-first, plan/network resources network-first.
const CACHE = "10kbuild-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js",
  "./firebase-config.js", "./plan.json", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Firebase/auth/sheet traffic: let it hit the network (SDK handles offline).
  if (url.origin !== location.origin) return;

  // Same-origin shell: cache-first with background refresh.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
