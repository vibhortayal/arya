/* Runs before the app bundle (audit M1, 2026-10-30). It starts the two
 * sign-in calls while the bundle downloads (app/session.tsx reads them
 * from window.__boot) and drops the start-page shell in index.html for
 * someone who was signed in last time, who should not see it flash.
 * A plain file, so the strict CSP (script-src 'self') allows it. */
(function () {
  var shell = document.getElementById("boot");
  var developers = /^\/developers\/?$/.test(location.pathname);
  var returning = false;
  try { returning = !!localStorage.getItem("arya.lastUser"); } catch (e) { /* private mode */ }
  if (shell && (returning || developers)) shell.remove();
  if (developers) return;
  var status = fetch("/auth/status").then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
  // Same meaning as session.tsx: null is "no answer", not "signed out".
  var me = fetch("/auth/me").then(function (r) { return r.ok ? r.json() : null; });
  status.catch(function () {});
  me.catch(function () {});
  window.__boot = { status: status, me: me };
  // Someone signed in last time also gets their settings and Today
  // started now, not one round trip after /auth/me (speed audit #5).
  // A signed-out answer (401) just falls back to the app's own read.
  if (returning) {
    var json = function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
    var hdr = { headers: { "X-Arya-Client": "boot" } };
    window.__boot.settings = fetch("/api/settings", hdr).then(json);
    window.__boot.today = fetch("/api/today", hdr).then(json);
    window.__boot.settings.catch(function () {});
    window.__boot.today.catch(function () {});
  }
})();
