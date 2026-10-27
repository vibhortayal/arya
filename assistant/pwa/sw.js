const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.json", "/icon.svg"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open("arya-v1").then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/import") || url.pathname.startsWith("/decode")) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
