/* The service worker (src/sw.js, built to /sw.js) as the plain-JS app
 * registered it (app.js): same URL and scope, so a phone that has the
 * old worker updates to this one. Push reminders (Profile) find it
 * with navigator.serviceWorker.ready. The Vite dev server has no
 * /sw.js, so dev runs without one. */
export function registerWorker(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => { /* the app works without it */ });
}
