const CACHE = "arya-v47";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/scene.js", "/quest.js", "/mapper.js", "/manifest.json", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-180.png", "/vendor/three.module.js",  "/assets/characters/manifest.json",
  "/assets/scenes/hero.webp",
  "/assets/scenes/score-party.webp",
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
  const url = new URL(e.request.url);
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
