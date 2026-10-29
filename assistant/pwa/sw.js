const CACHE = "arya-v94";
const SHELL = ["/", "/index.html", "/styles.css", "/hunt.css", "/pack.css", "/album.css", "/haul.css",
  "/app.js", "/lists.js", "/aryaask.js", "/huntask.js", "/pack.js", "/scene.js", "/quest.js", "/huntmenu.js", "/album.js", "/mapper.js", "/share.js", "/haul.js", "/expiry.js", "/group.js", "/push.js", "/powers.js", "/a2hs.js", "/manifest.json", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-180.png", "/vendor/three.module.js",  "/assets/characters/manifest.json",
  "/assets/scenes/hero.webp",
  "/assets/scenes/score-party.webp", "/assets/scenes/aisle-art.webp",
  "/assets/scenes/storefront.webp",
  "/assets/characters/compass.webp",
  "/assets/characters/basket.webp",
  "/assets/characters/binoculars.webp",
  "/assets/characters/blueberry.webp", "/assets/characters/banana.webp",
  "/assets/characters/raspberry.webp", "/assets/characters/mandarin.webp",
  "/assets/characters/egg.webp", "/assets/characters/cheese.webp",
  "/assets/characters/bread.webp", "/assets/characters/pasta.webp",
  "/assets/characters/pizza.webp", "/assets/characters/hummus.webp",
  "/assets/characters/olive-oil.webp", "/assets/characters/peanut-butter.webp",
  "/assets/characters/almond.webp", "/assets/characters/milk.webp",
  "/assets/characters/fruit.webp", "/assets/characters/vegetable.webp",
  "/assets/characters/dairy.webp", "/assets/characters/bakery.webp",
  "/assets/characters/frozen.webp", "/assets/characters/pantry.webp"];
const BYPASS = ["/api/", "/auth/", "/decode", "/import", "/eyes"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  // Writes and uploads never transit the worker: a forwarded POST
  // can arrive at the server with an empty body (the 2026-10-29
  // "empty upload" receipt bug on iOS). The browser's own stack
  // sends them untouched; the worker only shells GET reads.
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // The live-sync stream stays a plain browser request: no worker in
  // the middle of a connection that is meant to stay open.
  if (url.pathname === "/api/group/live") return;
  if (BYPASS.some(p => url.pathname.startsWith(p))) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Network-first for the shell: a new build is never masked by an old cache.
  e.respondWith(fetch(e.request)
    .then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    })
    .catch(() => caches.match(e.request)));
});

/* Push reminders: show the notification, open the list on tap. The
 * server only sends when the reminders flag is on. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || "Arya", {
    body: d.body || "", tag: d.tag || "arya", icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png", data: { url: d.url || "/#list" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#list";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) {
      if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
