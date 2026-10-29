/* Arya's service worker, served at /sw.js (the plain-JS app's URL, so a
 * phone that installed that app updates to this one by itself).
 * vite-plugin-pwa (injectManifest) builds it and fills in
 * self.__WB_MANIFEST: the built shell, every file hashed. No workbox
 * runtime; the rules are the old pwa/sw.js rules:
 *   - network first for every GET it handles, so a new build is never
 *     masked by an old cache; the cache is only the offline fallback;
 *   - API, sign-in, uploads and Eyes go straight to the network;
 *   - the live-sync stream (/api/group/live) is never touched;
 *   - non-GET requests are never touched (iOS sent forwarded POSTs
 *     with an empty body: the 2026-10-29 "empty upload" bug);
 *   - push reminders and the tap on one.
 * It takes over at once (skipWaiting + clients.claim) and deletes every
 * other cache, the old app's "arya-v*" shells included, so an old
 * cached shell can never keep a phone on the old app. */

const BUILD = self.__WB_MANIFEST || [];
// One cache per build: the name changes whenever a shell file changes.
const CACHE = "arya-web-" + hash(BUILD.map(e => e.url + "@" + (e.revision || "")).join("|"));
const SHELL = BUILD.map(e => new URL(e.url, self.registration.scope).pathname);
// Files the app loads at runtime from the static folder (pwa/): kept
// for offline use as the old shell kept them. Best effort: one missing
// file must not stop the install.
const STATIC = ["/scene.js", "/vendor/three.module.js", "/manifest.json", "/icon.svg",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-180.png",
  "/assets/characters/manifest.json", "/assets/scenes/hero.webp", "/assets/scenes/score-party.webp",
  "/assets/scenes/aisle-art.webp", "/assets/scenes/storefront.webp",
  ...["compass", "basket", "binoculars", "blueberry", "banana", "raspberry", "mandarin", "egg",
    "cheese", "bread", "pasta", "pizza", "hummus", "olive-oil", "peanut-butter", "almond", "milk",
    "fruit", "vegetable", "dairy", "bakery", "frozen", "pantry"].map(n => `/assets/characters/${n}.webp`)];
const BYPASS = ["/api/", "/auth/", "/decode", "/import", "/eyes"];

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL).then(() => Promise.all(STATIC.map(u => c.add(u).catch(() => {})))))
    .then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;
  // The live-sync stream stays a plain browser request: no worker in
  // the middle of a connection that is meant to stay open.
  if (url.pathname === "/api/group/live") return;
  if (BYPASS.some(p => url.pathname.startsWith(p))) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Network first for the shell: a new build is never masked by an old cache.
  e.respondWith(fetch(e.request)
    .then(resp => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return resp;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" })
      .then(hit => hit || (e.request.mode === "navigate" ? caches.match("/index.html") : undefined))
      .then(hit => hit || Response.error())));
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
