/* Push reminders (Profile). The server decides if the feature exists:
 * /api/push/config says enabled:false unless the flag and the VAPID
 * keys are set, and then the whole Reminders section stays hidden.
 * The permission prompt only appears when the person taps the switch. */
"use strict";

const PushUI = (() => {
  const $p = s => document.querySelector(s);
  let cfg = { enabled: false, notice_days: 2, subscribed: false };

  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function keyBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  function note(t) { $p("#rem-note").textContent = t; }
  const DEFAULT_NOTE = "One push a day at most, and only when something is due. Turn it off any time.";

  function paint() {
    const on = cfg.subscribed;
    const sw = $p("#rem-switch");
    sw.setAttribute("aria-checked", on ? "true" : "false");
    $p("#rem-more").hidden = !on;
    $p("#rem-sub").textContent = on ? "On. You will get a push when something is due" : "A push when something is about to run out";
    $p("#rem-dq").textContent = cfg.notice_days;
    $p("#rem-days-sub").textContent = `${cfg.notice_days} ${cfg.notice_days === 1 ? "day" : "days"} before it runs out`;
  }

  async function post(path, body) {
    return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  }

  async function load() {
    const box = $p("#pf-reminders");
    if (!box) return;
    try { cfg = await api("/api/push/config"); } catch (e) { cfg = { enabled: false }; }
    box.hidden = !cfg.enabled;
    if (!cfg.enabled) return;
    // A saved subscription the phone no longer has means "off" here.
    if (cfg.subscribed && supported()) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (!sub) cfg.subscribed = false;
    }
    paint();
    note(DEFAULT_NOTE);
    if (!supported() || (isIOS() && !standalone())) {
      note(isIOS() ? "On iPhone, add Arya to your Home Screen first (iOS 16.4 or newer), then open it from there."
                   : "This browser cannot show push reminders.");
      $p("#rem-switch").disabled = !supported();
    }
  }

  async function turnOn() {
    if (Notification.permission === "denied") { note("Blocked in phone settings. Allow notifications for Arya there, then try again."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { note("Reminders need notification permission. You can allow it in phone settings."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key)
    });
    cfg = await post("/api/push/subscribe", { subscription: sub.toJSON() });
    note(DEFAULT_NOTE);
  }
  async function turnOff() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    const endpoint = sub && sub.endpoint;
    if (sub) await sub.unsubscribe().catch(() => {});
    cfg = await post("/api/push/unsubscribe", { endpoint });
  }

  async function toggle() {
    const sw = $p("#rem-switch");
    sw.disabled = true;
    try { await (cfg.subscribed ? turnOff() : turnOn()); }
    catch (e) { note(e.message || "Could not change reminders."); }
    sw.disabled = false;
    paint();
  }
  async function days(delta) {
    const n = Math.min(7, Math.max(1, cfg.notice_days + delta));
    if (n === cfg.notice_days) return;
    try { cfg = await post("/api/push/settings", { notice_days: n }); } catch (e) { note(e.message); }
    paint();
  }
  async function test() {
    const b = $p("#rem-test");
    b.disabled = true;
    try { await post("/api/push/test"); note("Test reminder sent. Check your notifications."); }
    catch (e) { note(e.message || "Could not send the test."); }
    b.disabled = false;
  }

  // A tapped notification opens the app at /#list.
  function openFromHash() {
    if (location.hash !== "#list") return;
    let tries = 0;
    const t = setInterval(() => {
      const tab = document.querySelector('#tabs button[data-view="view-list"]');
      if ((tab && !document.querySelector("#tabs").hidden) || ++tries > 40) {
        clearInterval(t);
        if (tab && !document.querySelector("#tabs").hidden) tab.click();
        history.replaceState(null, "", location.pathname);
      }
    }, 250);
  }

  function init() {
    const sw = $p("#rem-switch");
    if (!sw) return;
    sw.addEventListener("click", toggle);
    $p("#rem-dm").addEventListener("click", () => days(-1));
    $p("#rem-dp").addEventListener("click", () => days(1));
    $p("#rem-test").addEventListener("click", test);
    $p("#avatar-btn").addEventListener("click", load);
    window.addEventListener("hashchange", openFromHash);
    openFromHash();
  }
  init();
  return { load };
})();
