import { toastGlobal } from "../ui/Toast";
import { t } from "../i18n";

/* The service worker (src/sw.js, built to /sw.js) as the plain-JS app
 * registered it (app.js): same URL and scope, so a phone that has the
 * old worker updates to this one. Push reminders (Profile) find it
 * with navigator.serviceWorker.ready. The Vite dev server has no
 * /sw.js, so dev runs without one.
 *
 * Registered after the page load and a quiet moment, so the worker's
 * precache never competes with the first screen's API calls (speed
 * audit #24). When a new build takes over an open tab, a toast offers
 * Reload (#23). */
export function registerWorker(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (had) toastGlobal(t("common.newVersion"), { action: t("common.reload"), onAction: () => location.reload() });
  });
  const go = () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      // Coming back to the app checks for a new build.
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    }).catch(() => { /* the app works without it */ });
  };
  const idle = () => {
    const ric = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(go, { timeout: 5000 }); else window.setTimeout(go, 2000);
  };
  if (document.readyState === "complete") idle(); else window.addEventListener("load", idle, { once: true });
}
