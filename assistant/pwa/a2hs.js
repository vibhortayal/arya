/* Add to Home Screen (owner, 2026-10-29; wireframe approved).
 * Today shows one dismissible card once there is a list and it is the
 * second visit or later; Profile has an always-there row. Android and
 * desktop Chrome: the button runs the browser's own install prompt.
 * iPhone: Safari cannot be triggered, so it opens four steps, including
 * leaving "Open as Web App" on (off = a plain Safari tab, no push).
 * Nothing shows once Arya runs from the Home Screen, or in the demo. */
"use strict";

const A2HS = (() => {
  const KEY = "arya.a2hs";
  const DISMISS_DAYS = 30;
  let deferred = null;
  let st = { visits: 0, dismissed: 0 };

  const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const demo = () => typeof isDemo !== "undefined" && isDemo;
  // Something to offer: the install prompt, or iPhone steps.
  const available = () => !installed() && !demo() && (!!deferred || isIOS());

  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* private window */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } };
  st.visits += 1; save();

  window.addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); deferred = ev; paintAll(); });
  window.addEventListener("appinstalled", () => { deferred = null; paintAll(); });

  const $a = s => document.querySelector(s);
  let lastHome = null;

  function dismissed() { return st.dismissed && Date.now() - st.dismissed < DISMISS_DAYS * 864e5; }

  function paintToday(h) {
    lastHome = h || lastHome;
    const box = $a("#today-a2hs");
    if (!box) return;
    const items = lastHome && lastHome.list ? (lastHome.list.items || []).filter(i => i.on_list) : [];
    if (!available() || dismissed() || st.visits < 2 || !items.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="group a2hs">
      <img class="rowface" src="assets/characters/basket.webp" alt="">
      <div class="grow"><b>Add Arya to your Home Screen</b><span class="sub">Full screen, with reminders.</span></div>
      <button class="chip" type="button" data-a2hs-go>${deferred ? "Install" : "Show how"}</button>
      <button class="a2hs-x" type="button" data-a2hs-x aria-label="Dismiss">&times;</button></div>`;
  }

  function paintProfile() {
    const row = $a("#btn-a2hs");
    if (row) row.hidden = !available();
  }
  function paintAll() { paintToday(); paintProfile(); }

  function openSteps() { const w = $a("#a2hs-sheet"); if (w) { w.hidden = false; const c = $a("#a2hs-close"); if (c) c.focus(); } }
  function closeSteps() { const w = $a("#a2hs-sheet"); if (w) w.hidden = true; }

  async function go() {
    if (deferred) {
      const ev = deferred; deferred = null;
      try { await ev.prompt(); await ev.userChoice; } catch (e) { /* closed */ }
      paintAll();
      return;
    }
    openSteps();
  }

  document.addEventListener("click", ev => {
    if (ev.target.closest("[data-a2hs-go]") || ev.target.closest("#btn-a2hs")) { go(); return; }
    if (ev.target.closest("[data-a2hs-x]")) { st.dismissed = Date.now(); save(); paintToday(); return; }
    if (ev.target.closest("#a2hs-close") || ev.target.id === "a2hs-sheet") closeSteps();
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") closeSteps(); });
  document.addEventListener("DOMContentLoaded", paintProfile);
  window.addEventListener("load", paintProfile);

  return { paintToday, paintProfile, available };
})();
window.A2HS = A2HS;
