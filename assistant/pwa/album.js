"use strict";
/* Album (Game: album). Real product stickers, the Album screen, the
 * "New sticker" card and the level-up card with the unlock ladder.
 *
 * Contract notes (see the cross-slice contracts C8, C9, C10):
 * - quest.js loads before this file and never needs it: every call
 *   into here is guarded there. This file reads Q (the hunt state)
 *   and putBackStop only when it runs, never at load.
 * - The sticker card reacts to the "arya:grabbed" event. It reads
 *   Q.current.new_sticker, which /check returned on a first-time
 *   product, and deletes it afterwards. A stale one is ignored.
 * - No prices, no friends, no trading, no chat. The album is private.
 * - localStorage is wrapped in try/catch with an in-memory fallback.
 * Product copy: short plain sentences, one idea each. */

const ALB_SLOTS = 8;
const ALB_CARD_MS = 2600;
const ALB_LEVEL_KEY = "arya-album-level";
const ALB_FALLBACK_ART = "basket.webp";
const ALB_OTHER = "Other finds";
const ALB_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const albMem = { level: null, tab: null };
const albState = { view: null, tab: null };
let albCardTimer = null;

function albEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function albLow(s) { return String(s || "").trim().toLowerCase(); }
function albDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${ALB_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/* ---------------- pure helpers (exported by name) ---------------- */

/* Where a sticker's picture comes from: the cutout the server made
 * (private to the account), else stock character art. */
function albumStickerSrc(st) {
  if (st && st.image === "cutout" && st.image_url) return st.image_url;
  return "assets/characters/" + ((st && st.art) || ALB_FALLBACK_ART);
}

/* The 8-slot chunks of a page. Each chunk is an array of 8 stickers
 * or null (an empty slot). "Other finds" is one chunk of page.size.
 * A page of 11 gives two chunks. An empty page gives one empty chunk. */
function albumSlots(page) {
  const list = (page && page.stickers) || [];
  if (page && page.kind === "other") {
    const size = Math.max(page.size || 4, list.length, 4);
    return [Array.from({ length: size }, (_, i) => list[i] || null)];
  }
  const n = Math.max(1, Math.ceil(list.length / ALB_SLOTS));
  const out = [];
  for (let c = 0; c < n; c++)
    out.push(Array.from({ length: ALB_SLOTS }, (_, i) => list[c * ALB_SLOTS + i] || null));
  return out;
}

/* "3 of 8". A page past its size says how many it holds. */
function albumProgressText(page) {
  const count = (page && page.count) || 0;
  const size = (page && page.size) || ALB_SLOTS;
  return count > size ? `${count} stickers` : `${count} of ${size}`;
}
function albumProgressPct(page) {
  const size = (page && page.size) || ALB_SLOTS;
  return Math.max(0, Math.min(100, Math.round(100 * ((page && page.count) || 0) / size)));
}

/* A set of lowercased names from a list of {name} rows. */
function albumNewSetFrom(list) {
  const out = new Set();
  for (const x of list || []) {
    const n = albLow(x && x.name);
    if (n) out.add(n);
  }
  return out;
}

/* The level-up card body. prevLevel is the level the shopper last
 * saw. Rungs gained are those between prevLevel and the new level.
 * "Live" means the thing is in the app now. "Coming soon" never
 * means locked: nothing is locked by level. Features that work for
 * everyone today are not rungs: they sit in the "Open to everyone"
 * line, so the card never calls them new. */
function albumLevelHtml(profile, prevLevel) {
  const level = Number(profile && profile.level) || 1;
  const u = (profile && profile.unlocks) || {};
  const ladder = u.ladder || [];
  const from = prevLevel == null ? level - 1 : Number(prevLevel);
  const gained = ladder.filter(r => r.level > from && r.level <= level);
  const next = ladder.find(r => r.level > level) || null;
  const chip = r => r.live
    ? `<span class="ladderchip live">Live</span>`
    : `<span class="ladderchip">Coming soon</span>`;
  const row = r => `<div class="ladderrow${r.reached === false ? " ahead" : ""}"><b>L${r.level}</b><span class="ladderttl">${albEsc(r.title)}</span>${chip(r)}</div>`;
  const never = (u.never_locked || []).join(", ");
  const open = (u.open_to_all || []).join(", ");
  return `<div class="levelcard">
    <p class="levelkick">Level up</p>
    <div class="levelnum">${level}</div>
    <p class="levelsub">You reached level ${level}.</p>
    ${gained.length
      ? `<h4 class="levelhead">New at this level</h4><div class="ladder">${gained.map(row).join("")}</div>`
      : `<p class="levelsub">Keep hunting. Your next rung is close.</p>`}
    ${next ? `<h4 class="levelhead">Next</h4><div class="ladder">${row({ ...next, reached: false })}</div>` : ""}
    ${open ? `<p class="levelnever">Open to everyone: ${albEsc(open)}.</p>` : ""}
    ${never ? `<p class="levelnever">Never locked by level: ${albEsc(never)}.</p>` : ""}
    <button type="button" class="btn primary wide" data-alb-close>Keep going</button>
  </div>`;
}

/* ---------------- level record (try/catch + memory) ---------------- */

function albumLevelSeen() {
  try {
    const v = localStorage.getItem(ALB_LEVEL_KEY);
    if (v !== null && v !== undefined && v !== "" && !isNaN(Number(v))) return Number(v);
    if (albMem.level !== null) return albMem.level;
    return null;
  } catch (e) { return albMem.level; }
}
function albumLevelSave(level) {
  albMem.level = level;
  try { localStorage.setItem(ALB_LEVEL_KEY, String(level)); } catch (e) { /* memory keeps it */ }
}

/* First run (nothing recorded) records the level and shows nothing.
 * Later, a higher level shows the card once and records it. */
function albumMaybeLevelUp(profile) {
  const lv = Number(profile && profile.level);
  if (!lv) return false;
  const seen = albumLevelSeen();
  if (seen === null) { albumLevelSave(lv); return false; }
  if (lv <= seen) return false;
  albumLevelSave(lv);
  albumShowLevel(profile, seen);
  return true;
}
function albumRecordLevel(profile) {
  const lv = Number(profile && profile.level);
  if (lv && albumLevelSeen() === null) albumLevelSave(lv);
}

function albumShowLevel(profile, prevLevel) {
  const wrap = $("#alb-level");
  if (!wrap) return;
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Level up">${albumLevelHtml(profile, prevLevel)}</div>`;
  wrap.hidden = false;
}
function albumCloseLevel() {
  const wrap = $("#alb-level");
  if (wrap) { wrap.hidden = true; wrap.innerHTML = ""; }
}

/* ---------------- data ---------------- */

function albSid(sessOrId) {
  return typeof sessOrId === "string" ? sessOrId : (sessOrId && sessOrId.id) || "";
}
/* Names of the stickers first made in this session. Empty on any
 * failure, so a caller just shows no NEW badge. */
async function albumNewFor(sessOrId) {
  try {
    const sid = albSid(sessOrId);
    if (!sid) return new Set();
    const r = await api(`/api/quest/stickers/new?session=${encodeURIComponent(sid)}`);
    return albumNewSetFrom(r && r.new);
  } catch (e) { return new Set(); }
}
/* One sticker per grabbed item of the session. Empty on failure. */
async function albumHaul(sessOrId) {
  try {
    const sid = albSid(sessOrId);
    if (!sid) return [];
    const r = await api(`/api/quest/stickers?session=${encodeURIComponent(sid)}`);
    return (r && r.stickers) || [];
  } catch (e) { return []; }
}

/* ---------------- the New sticker card ---------------- */

function albCardEl() { return $("#stk-card"); }
function albHideCard() {
  if (albCardTimer) { clearTimeout(albCardTimer); albCardTimer = null; }
  const el = albCardEl();
  if (el) { el.hidden = true; el.innerHTML = ""; }
}
function albCardOpen() {
  const el = albCardEl();
  return !!(el && !el.hidden);
}
/* Show the card for a first-time sticker. It never blocks Grab: it
 * sits above the toast line, closes by itself after 2600 ms and has
 * no timer on screen. A second card replaces the first. Express never
 * shows it. */
function albOnNewSticker(sess, st, badge) {
  if (!st || (sess && sess.mode === "express")) return false;
  const el = albCardEl();
  if (!el) return false;
  if (albCardTimer) { clearTimeout(albCardTimer); albCardTimer = null; }
  el.dataset.key = st.key || "";
  el.dataset.name = st.name || "";
  el.innerHTML = `<img class="stkimg" src="${albEsc(albumStickerSrc(st))}" alt="">
    <div class="stkbody"><b class="stkhead">New sticker</b><span class="stkname">${albEsc(st.name)}</span>${
      badge && badge.name ? `<span class="stkbadge">Page full. Add your receipt to earn ${albEsc(badge.name)}.</span>` : ""}</div>
    <button type="button" class="undo" data-stk-undo>Undo</button>`;
  el.hidden = false;
  albCardTimer = setTimeout(albHideCard, ALB_CARD_MS);
  return true;
}
function albUndoIndex(sess, key, name) {
  const items = (sess && sess.items) || [];
  return items.findIndex(i => (key && i.group === key) || albLow(i.name) === albLow(name));
}
function albCardUndo() {
  const el = albCardEl();
  if (!el) return;
  const key = el.dataset.key, name = el.dataset.name;
  albHideCard();
  const sess = typeof Q !== "undefined" ? Q.current : null;
  const idx = albUndoIndex(sess, key, name);
  if (idx >= 0 && typeof putBackStop === "function") putBackStop(idx);
}

/* The hunt dispatches arya:grabbed after /check. The sticker rides on
 * Q.current.new_sticker. Use it once, then drop it. */
function albOnGrabbed(ev) {
  const sess = typeof Q !== "undefined" ? Q.current : null;
  const ns = sess && sess.new_sticker;
  if (sess) delete sess.new_sticker;
  const d = (ev && ev.detail) || {};
  const st = ns && ns.sticker;
  const same = !!st && !!((st.key && d.group && st.key === d.group) || (d.name && albLow(st.name) === albLow(d.name)));
  if (same && albOnNewSticker(sess, st, ns.page_badge)) return;
  // No new sticker for THIS grab (a repeat find, a stale payload, or
  // Express): an earlier card belongs to an earlier item. Close it, so
  // the hunt can show this grab's "in your cart" toast and its Undo.
  albHideCard();
}

/* ---------------- the Album screen ---------------- */

function albTabsHtml(pages, cur) {
  return `<div class="albtabs" role="group" aria-label="Album pages">${pages.map(p =>
    `<button type="button" class="albtab" data-alb-tab="${albEsc(p.id)}" aria-pressed="${p.id === cur}">${albEsc(p.title || (p.kind === "other" ? ALB_OTHER : p.id))}</button>`).join("")}</div>`;
}
function albSlotHtml(st, page) {
  if (!st) return `<div class="albslot empty${page.kind === "season" ? " season" : ""}" aria-label="Not found yet"></div>`;
  return `<button type="button" class="albslot${page.kind === "season" ? " season" : ""}" data-alb-slot="${albEsc(st.id)}" aria-label="${albEsc(st.name)}"><img src="${albEsc(albumStickerSrc(st))}" alt="" loading="lazy"></button>`;
}
function albBadgeHtml(page) {
  const b = page.badge;
  if (!b) return "";
  const text = b.text || (b.earned ? `${b.name} earned.` : `${b.to_go} to go. No rush.`);
  return `<div class="albbadge${b.earned ? " earned" : ""}"><div class="grow"><b>${albEsc(b.name)}</b><span class="sub">${albEsc(text)}</span></div>${
    b.earned ? `<span class="albchip">Earned</span>` : ""}</div>`;
}
function albPageHtml(page) {
  const chunks = albumSlots(page);
  const kicker = page.kind === "season" ? `<span class="albchip">Seasonal</span>` : "";
  const note = page.note ? `<p class="sub albnote">${albEsc(page.note)}</p>` : "";
  const grids = chunks.map((chunk, i) =>
    `${chunks.length > 1 ? `<p class="sub albchunk">Sheet ${i + 1} of ${chunks.length}</p>` : ""}<div class="albgrid">${chunk.map(st => albSlotHtml(st, page)).join("")}</div>`).join("");
  return `<div class="group pad albpage">
    <div class="albhead"><b class="albtitle">${albEsc(page.title || (page.kind === "other" ? ALB_OTHER : page.id))}</b>${kicker}<span class="albcount">${albEsc(albumProgressText(page))}</span></div>
    <div class="albprog" role="progressbar" aria-valuemin="0" aria-valuemax="${page.size || ALB_SLOTS}" aria-valuenow="${page.count || 0}"><i style="width:${albumProgressPct(page)}%"></i></div>
    ${note}${grids}${albBadgeHtml(page)}</div>`;
}
function albChaptersHtml(chapters) {
  return (chapters || []).map(c => `<div class="group pad albchapter">
    <img class="albchimg" src="assets/characters/compass.webp" alt="">
    <div class="grow"><b>Community chapter</b><span class="sub">${albEsc(c.text)}</span></div>${
      c.earned ? `<span class="albchip">Earned</span>` : ""}</div>`).join("");
}
function albEmptyHtml() {
  return `<div class="group pad albempty"><div class="emptyface-wrap"><img class="emptyface" src="assets/characters/basket.webp" alt=""></div>
    <p class="empty">No stickers yet. Grab an item on a hunt and its sticker lands here.</p></div>`;
}
function albumPaintNav(n) {
  const el = $("#album-nav-sub");
  if (!el || typeof n !== "number") return;
  el.textContent = n === 0 ? "No stickers yet" : n === 1 ? "1 sticker" : `${n} stickers`;
}

function albPaint() {
  const v = albState.view;
  const body = $("#alb-body");
  if (!v || !body) return;
  const pages = v.pages || [];
  const sub = $("#alb-sub");
  if (sub) sub.textContent = v.total === 1 ? "1 sticker collected" : `${v.total || 0} stickers collected`;
  if (!pages.find(p => p.id === albState.tab)) albState.tab = pages.length ? pages[0].id : null;
  const cur = pages.find(p => p.id === albState.tab);
  albKeepStrip(body, () => {
    body.innerHTML = (v.total ? "" : albEmptyHtml()) +
      (pages.length && (v.total || cur) ? albTabsHtml(pages, albState.tab) + (cur ? albPageHtml(cur) : "") : "") +
      albChaptersHtml(v.chapters) +
      `<p class="muted albprivate">Your album is private. Only you can see it.</p>`;
  });
}

/* The tab strip scrolls sideways (up to 9 pages). A repaint rebuilds
 * it, so keep its scroll position and bring the chosen tab into view. */
function albKeepStrip(body, paint) {
  const find = () => (body.querySelector ? body.querySelector(".albtabs") : null);
  const old = find();
  const left = old ? old.scrollLeft : 0;
  paint();
  const strip = find();
  if (!strip) return;
  strip.scrollLeft = left;
  const act = strip.querySelector ? strip.querySelector('[aria-pressed="true"]') : null;
  if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function renderAlbum() {
  const body = $("#alb-body");
  if (body && !albState.view) body.innerHTML = `<p class="empty">Loading your album.</p>`;
  const v = await api("/api/quest/album");
  albState.view = v;
  albPaint();
  albumPaintNav(v.total);
}

/* A sticker's sheet: name, first found, found count, and the truth. */
function albOpenSheet(id) {
  const v = albState.view;
  let st = null;
  for (const p of (v && v.pages) || []) st = st || (p.stickers || []).find(s => s.id === id);
  const wrap = $("#alb-sheet");
  if (!st || !wrap) return;
  const cut = st.image === "cutout";
  const n = st.found_count || 1;
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${albEsc(st.name)}">
    <div class="albsheet">
      <img class="albsheetimg" src="${albEsc(albumStickerSrc(st))}" alt="">
      <h3 class="albsheettitle">${albEsc(st.name)}</h3>
      ${st.first_found_at ? `<p class="sub">First found ${albEsc(albDate(st.first_found_at))}${st.store ? ` at ${albEsc(st.store)}` : ""}</p>` : ""}
      <p class="sub">Found in ${n} hunt${n === 1 ? "" : "s"}</p>
      <p class="albtruth">${cut ? "Only the product is kept in your album. No people." : "This sticker uses stock art. Your album keeps no photo of it."}</p>
      <button type="button" class="btn secondary wide" data-alb-close>Close</button>
    </div></div>`;
  wrap.hidden = false;
}
function albCloseSheet() {
  const wrap = $("#alb-sheet");
  if (wrap) { wrap.hidden = true; wrap.innerHTML = ""; }
}

/* ---------------- DOM, wiring ---------------- */

function albInject() {
  // index.html ships the empty #view-album section, so the Album row
  // never opens a missing screen. Make it here only if it is absent.
  if (!document.getElementById("view-album")) {
    const host = document.querySelector("main") || document.body;
    host.insertAdjacentHTML("beforeend",
      `<section id="view-album" class="view" hidden>
        <p><a href="#" class="qback">&larr; Back</a></p>
        <h2 class="largetitle">Album</h2>
        <p class="subtitle" id="alb-sub"></p>
        <div id="alb-body"></div>
      </section>`);
  }
  if (document.getElementById("stk-card")) return;
  document.body.insertAdjacentHTML("beforeend",
    `<div id="stk-card" class="stkcard" role="status" aria-live="polite" hidden></div>
     <div id="alb-sheet" class="sheetwrap" hidden></div>
     <div id="alb-level" class="sheetwrap" hidden></div>`);
}

function albWire() {
  const body = $("#alb-body");
  if (body) body.addEventListener("click", ev => {
    const tab = ev.target.closest && ev.target.closest("[data-alb-tab]");
    if (tab) { albState.tab = tab.dataset.albTab; albPaint(); return; }
    const slot = ev.target.closest && ev.target.closest("[data-alb-slot]");
    if (slot) albOpenSheet(slot.dataset.albSlot);
  });
  const card = $("#stk-card");
  if (card) card.addEventListener("click", ev => {
    if (ev.target.closest && ev.target.closest("[data-stk-undo]")) albCardUndo();
  });
  for (const id of ["#alb-sheet", "#alb-level"]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("click", ev => {
      if (ev.target === el || (ev.target.closest && ev.target.closest("[data-alb-close]"))) {
        if (id === "#alb-level") albumCloseLevel(); else albCloseSheet();
      }
    });
  }
  document.addEventListener("arya:grabbed", albOnGrabbed);
  document.addEventListener("arya:putback", albHideCard);
}

/* The nav row says how many stickers there are. It paints when a
 * profile arrives (Today: paintLevelChip is wrapped here) and when the
 * Crew screen opens (renderCommunity calls albumPaintNav with the
 * profile it already loaded: no second fetch). */
function albHook() {
  try {
    if (typeof paintLevelChip === "function" && !paintLevelChip.__alb) {
      const orig = paintLevelChip;
      const wrapped = function (profile) {
        const r = orig.apply(this, arguments);
        try {
          if (profile && profile.album) albumPaintNav(profile.album.stickers);
          albumRecordLevel(profile);
        } catch (e) { /* garnish */ }
        return r;
      };
      wrapped.__alb = true;
      window.paintLevelChip = wrapped;
    }
  } catch (e) { /* hooks are optional */ }
}

window.AlbumUI = {
  onNewSticker: albOnNewSticker,
  cardOpen: albCardOpen,
  maybeLevelUp: albumMaybeLevelUp,
};
window.renderAlbum = renderAlbum;
window.albumPaintNav = albumPaintNav;

try { albInject(); albWire(); albHook(); } catch (e) { /* the album is optional */ }
