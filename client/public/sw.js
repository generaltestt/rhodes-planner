const SHELL_CACHE = "rhodes-shell-v1";
const DATA_CACHE = "rhodes-data-v1";
const IMG_CACHE = "rhodes-img-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![SHELL_CACHE, DATA_CACHE, IMG_CACHE].includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache auth or non-GET requests
  if (req.method !== "GET" || url.pathname === "/api/login") return;

  // API GETs: network-first, fall back to last cached copy (offline itinerary viewing)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } })))
    );
    return;
  }

  // Map tiles + external photos: cache-first with cap
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(req).then(
        (m) =>
          m ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(IMG_CACHE).then(async (c) => {
                await c.put(req, copy);
                trimCache(IMG_CACHE, 300);
              });
            }
            return res;
          })
      )
    );
    return;
  }

  // App shell + built assets: cache-first, update in background
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
