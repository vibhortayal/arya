"use strict";
const $ = s => document.querySelector(s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function fmtShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  // The year shows when it is not this year: an archive spans years.
  return y && y !== new Date().getFullYear() ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}
/* The account's currency (Profile > Account): the symbol prices show
 * with. Display only: amounts are never converted. USD until the
 * settings load. */
let CURRENCY = { code: "USD", symbol: "$" };
const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "C$", AUD: "A$" };
function money(n) {
  return CURRENCY.symbol + Math.abs(n).toFixed(2);
}
async function loadCurrency() {
  try {
    const s = await api("/api/settings");
    CURRENCY = { code: s.currency, symbol: s.symbol };
  } catch (e) { /* keep the default */ }
}
function qtyFmt(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
/* The amount of a row as people say it: "x2", or "2 kg" when the row
 * carries a free-text unit. "" for a plain single. */
function qtyTag(it) {
  const unit = String((it && it.unit) || "").trim();
  if (unit) return `${qtyFmt(it.qty)} ${unit}`;
  return it && it.qty > 1 ? `x${qtyFmt(it.qty)}` : "";
}
async function api(path, opts) {
  let r;
  try { r = await fetch(path, opts); }
  catch (e) {
    // A network failure stays a TypeError (the hunt's offline outbox
    // keys on it) but reads as what it is.
    throw new TypeError("No connection right now — try again when you're back online.");
  }
  if (!r.ok) throw new Error(friendlyError((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`));
  return r.json();
}
/* Server details are short codes for developers; the person reads
 * a sentence (QA 2026-10-28). */
const FRIENDLY = {
  "no such session": "That hunt is gone — the demo resets now and then. Go back to Today and start it again.",
  "no account with that handle": "No one has that handle. Check the spelling and try again.",
  "this needs a real account": "This needs a real account — the demo keeps nothing.",
};
function friendlyError(d) {
  const s = typeof d === "string" ? d : "Something went wrong.";
  const key = s.toLowerCase().replace(/[.\s]+$/, "");
  if (FRIENDLY[key]) return FRIENDLY[key];
  if (key.startsWith("this needs a real account")) return FRIENDLY["this needs a real account"];
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
function put(path, body) {
  return api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
let toastTimer = null;
/* How long a toast stays up: 60 ms a character, at least 4 s, and at
 * least 7 s when it carries an action (Undo). */
function toastMs(msg, hasAction) {
  return Math.max(hasAction ? 7000 : 4000, 60 * String(msg == null ? "" : msg).length);
}
function toast(msg, opts) {
  const t = $("#toast");
  clearTimeout(toastTimer);
  // The text goes in first (the live region reads the message), then
  // the buttons are appended.
  t.textContent = msg;
  // An optional one-tap action (Undo) rides on the toast, which then
  // stays a little longer.
  if (opts && opts.action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toastact";
    b.textContent = opts.action;
    b.addEventListener("click", () => { clearTimeout(toastTimer); t.hidden = true; opts.onAction && opts.onAction(); });
    t.appendChild(b);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "toastclose";
  x.setAttribute("aria-label", "Dismiss");
  x.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  x.addEventListener("click", () => { clearTimeout(toastTimer); t.hidden = true; });
  t.appendChild(x);
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, toastMs(msg, !!(opts && opts.action)));
}
function showErr(e) { toast("Could not load: " + e.message); }
function row(name, sub, right) {
  return `<div class="row"><div class="grow"><span class="name">${name}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div><div class="money">${right || ""}</div></div>`;
}
function empty(text) {
  return `<p class="empty">${text}</p>`;
}

let lastView = "view-home";
let receiptsFrom = "view-profile";  // Brain view that opened Receipts (B4)
let listItems = {};
let isDemo = false;

/* ---------------- Home ---------------- */

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 10 18 19.5 6.5"/></svg>`;

const PEN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>`;
const SPARK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.2 7.3 7.3 2.2-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2L12 2.5z"/></svg>`;

function bindItemLinks(root) {
  if (!root) return;
  root.querySelectorAll(".item-link").forEach(a =>
    a.addEventListener("click", ev => { ev.preventDefault(); renderItem(a.dataset.id); }));
}

/* The owner's Today/List line (revised at his word, 2026-10-28):
 * a count only. The names live on the List itself — Today taps
 * through to it — and the returns sentence is gone. */
function staplesLine(items) {
  /* Due staples only: the patterns' rows, not what you ticked off or
   * typed in by hand (QA 2026-10-28). */
  const n = (items || []).filter(i => !i.checked && i.source !== "user").length;
  if (!n) return "Nothing due";
  return `${n} staple${n === 1 ? "" : "s"} due`;
}

/* The character registry (owner, 2026-10-28): the manifest maps an
 * item to its character — exact item first, then category, then the
 * basket fallback. The brain settles what an item IS; this only maps
 * that identity to art and never guesses a match of its own. */
let CHARM = null;
let TODAY_HOME = null;  // the last /api/home Today painted
fetch("assets/characters/manifest.json").then(r => r.json()).then(m => {
  CHARM = m;
  if (TODAY_HOME) paintTodayLow(TODAY_HOME);  // faces arrive late: repaint
}).catch(() => {});
function charMatch(tokens, kw) {
  const kt = kw.split(" ");
  for (let i = 0; i + kt.length <= tokens.length; i++)
    if (kt.every((w, j) => tokens[i + j] === w)) return true;
  return false;
}
function charFor(name) {
  if (!CHARM) return null;
  const tokens = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  for (const r of CHARM.items || [])
    if ((r.keywords || []).some(k => charMatch(tokens, k))) return r.char;
  for (const c of CHARM.categories || [])
    if ((c.keywords || []).some(k => charMatch(tokens, k))) return c.char;
  return CHARM.fallback || null;
}

/* ---------------- Today (decluttered) ----------------
 * Greeting, ONE hero card (the resumable hunt; Resume is the only
 * primary button), compact game rows, one Needs-your-eye row, and
 * the list as one plain-text line. No money, no Community/Profile
 * cards — those live behind the Profile tab. */

const QSTATE_LBL = { not_started: "Not started", playing: "Playing", paused: "Paused", finished: "Finished · Receipt missing", done: "Finished · Receipt attached ✓" };
const QMODE_LBL = { quest: "Quest", express: "Express" };
const BASKET_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.8 13 11 7.2M15.2 13 13 7.2"/><path d="M3.5 13h17l-1.8 6a2 2 0 0 1-1.9 1.4H7.2A2 2 0 0 1 5.3 19L3.5 13z"/><path d="M9 16.2v2.3M12 16.2v2.3M15 16.2v2.3"/></svg>`;

function sessProgress(s) {
  const total = s.items.length;
  const done = s.items.filter(i => i.checked).length;
  return { done, total };
}

function openSess(id) {
  const s = window.qSessionById ? qSessionById(id) : null;
  if (s && window.qOpenSession) qOpenSession(s);
}

/* Level and points (owner, 2026-10-28): the bragging chip on Today
 * and the player card. Points bank with receipts; levels never drop. */
/* Badge art: each badge wears a character (owner, 2026-10-28). */
const BADGE_ART = { top_contributor: "blueberry.webp", egg_baron: "egg.webp",
  banana_republic: "banana.webp", speed_demon: "pizza.webp",
  clean_sweep: "basket.webp", first_mapper: "compass.webp",
  eagle_eye: "binoculars.webp", receipt_keeper: "pantry.webp" };

function paintLevelChip(profile) {
  const el = $("#today-level");
  if (!el || !profile || !profile.level) return;
  el.innerHTML = `Level ${profile.level} <span>· ${profile.points} pts</span>`;
  el.hidden = false;
  // The avatar ring fills toward the next level.
  const span = (profile.next_level_at - profile.level_floor) || 1;
  const pct = Math.max(0, Math.min(100, Math.round((profile.points - profile.level_floor) / span * 100)));
  $("#avatar-btn").style.setProperty("--pct", pct + "%");
  $("#avatar-btn").setAttribute("aria-label", `Profile, level ${profile.level}`);
}
/* Hunt v2 item 6: a finished hunt is closed — it leaves the hero.
 * The hero is the NEWEST hunt that still wants play (play-test:
 * three old hunts all said Resume); older open ones fold away. */
function heroSession(sessions) {
  return sessions.filter(s => s.state === "playing" || s.state === "paused" || s.state === "not_started")
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}
function paintTodayHero(sessions) {
  const el = $("#today-hero");
  const hero = heroSession(sessions);
  if (!hero) {
    el.innerHTML = `<article class="herocard quiet">
      <p class="hero-k">No quest in progress</p>
      <p class="hero-sub nomargin">Nothing is waiting on you.</p>
    </article>`;
    return;
  }
  const p = sessProgress(hero);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const kicker = hero.state === "not_started" ? "Up next — your next game" : "In progress — your next action";
  const btn = hero.state === "not_started" ? "Start ▸" : "Resume ▸";
  el.innerHTML = `<article class="herocard">
    <p class="hero-k">${kicker}</p>
    <h3 class="hero-title">${esc(hero.store)} · ${QMODE_LBL[hero.mode] || esc(hero.mode)}</h3>
    <p class="hero-sub">${p.total} item${p.total === 1 ? "" : "s"} · from your ${esc(hero.store)} list</p>
    <span class="track"><span class="bar" style="width:${pct}%"></span></span>
    <span class="hero-state">${QSTATE_LBL[hero.state] || esc(hero.state)} · ${p.done} of ${p.total} collected</span>
    <button class="btn primary wide" data-hero="${esc(hero.id)}" type="button">${btn}</button>
  </article>`;
  el.querySelector("[data-hero]").addEventListener("click", ev => openSess(ev.currentTarget.dataset.hero));
}

function gameRow(s) {
  const p = sessProgress(s);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const bar = (s.state === "playing" || s.state === "paused")
    ? `<span class="track g-bar"><span class="bar" style="width:${pct}%"></span></span>` : "";
  return `<button class="gamerow" data-sess="${esc(s.id)}" type="button">
    <span class="storeic">${BASKET_SVG}</span>
    <span class="g-main"><span class="g-name">${esc(s.store)} — ${QMODE_LBL[s.mode] || esc(s.mode)}</span>
    <span class="g-meta">${QSTATE_LBL[s.state] || esc(s.state)} · ${p.done} of ${p.total}</span></span>
    ${bar}<span class="chev">›</span></button>`;
}
/* Open hunts first; each finished hunt appears once, under Finished. */
function paintTodayGames(sessions) {
  const el = $("#quest-sessions");
  const closed = s => s.state === "finished" || s.state === "done";
  const open = sessions.filter(s => !closed(s)), done = sessions.filter(closed);
  // The hero card already carries the hunt to resume; any other open
  // hunts fold away so Today shows one thing to do.
  const hero = heroSession(open);
  const rest = open.filter(s => s !== hero);
  const openHtml = hero ? gameRow(hero) +
    (rest.length ? `<details class="g-fold"><summary>${rest.length} other open hunt${rest.length === 1 ? "" : "s"}</summary>${rest.map(s => `<div class="earlierrow">${gameRow(s)}<button class="btn danger" data-abandon="${esc(s.id)}" type="button">Abandon</button></div>`).join("")}</details>` : "") : "";
  el.innerHTML = sessions.length
    ? openHtml +
      (done.length ? `<p class="g-group">Finished</p>` + done.map(gameRow).join("") : "")
    : `<p class="empty">No hunts yet today. Start one — the list becomes the game.</p>`;
}

/* ---------------- Quest tab hub ----------------
 * The list-first pass (owner, 2026-10-29: "Quest is the Pokemon Go
 * part of our app. we should not make quest as the hero"): the hunt
 * hero card, the games and the level chip moved from Today to the
 * Quest tab, above the Crew rows that tab already had. */
async function renderQuestHub() {
  let sessions = [];
  if (window.qLoadSessions) {
    try { sessions = await qLoadSessions(); } catch (e) { sessions = []; }
  }
  paintTodayHero(sessions);
  paintTodayGames(sessions);
  api("/api/quest/profile").then(paintLevelChip).catch(() => {});
}

/* ---------------- Today: the shopping dashboard ----------------
 * Waze for grocery shopping (owner, 2026-10-29): what is running
 * low and why, what is up at your stores, what to use soon, your
 * lists and your month. Every row is a fact Arya already holds; no
 * new model calls. */

function paintTodayLow(h) {
  const low = (h.running_low || []).slice(0, 5);
  // Due staples are suggestions until added (List overhaul): only
  // what the household put on a list reads "On list".
  const onList = new Set((h.list.items || []).filter(i => !i.checked && i.on_list).map(i => i.item_id));
  const cap = t => String(t || "").replace(/^./, c => c.toUpperCase());
  const el = $("#today-low");
  if (!low.length) {
    el.innerHTML = `<h3 class="sect">Running low</h3><div class="group pad">${empty("Nothing is running low. Arya learns your rhythm from receipts.")}</div>`;
    return;
  }
  el.innerHTML = `<h3 class="sect">Running low</h3><div class="group">${low.map(i => {
    const c = charFor(i.name);
    const act = onList.has(i.item_id)
      ? `<span class="chip onlist" aria-label="On your list">On list</span>`
      : `<button class="chip" data-low-add="${esc(i.item_id)}" type="button" aria-label="Add ${esc(i.name)} to your list">Add</button>`;
    return `<div class="row">${c ? `<img class="rowface" src="assets/characters/${c}" alt="">` : ""}
      <div class="grow"><a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a><span class="sub">${esc(cap(i.reason))}</span></div>${act}</div>`;
  }).join("")}</div>`;
  bindItemLinks(el);
}

$("#today-low").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-low-add]");
  if (!b) return;
  b.disabled = true;
  try {
    await post("/api/list/add", { item_id: b.dataset.lowAdd });
    b.outerHTML = `<span class="chip onlist">On list</span>`;
    toast("Added to your list.");
  } catch (e) { b.disabled = false; toast(e.message); }
});

/* Store alerts: the crew's "not here" reports, and where an item on
 * your list costs less (median price per store, from your own
 * receipts). Nothing is guessed: no report, no price, no row. */
function storeAlertRows(h, news) {
  const onList = new Set((h.list.items || []).filter(i => !i.checked && i.on_list).map(i => String(i.name || "").toLowerCase()));
  const rows = (news || []).slice(0, 3).map(n => {
    const mine = onList.has(String(n.item || "").toLowerCase());
    return `<div class="row"><span class="alertic" aria-hidden="true">!</span><div class="grow">
      <span class="name">${esc(n.store)}: ${esc(n.item)} not there</span>
      <span class="sub">${n.count} report${n.count === 1 ? "" : "s"} · ${fmtShort(String(n.reported_at || "").slice(0, 10))}${mine ? " · it's on your list" : ""}</span></div></div>`;
  });
  const names = Object.fromEntries((h.list.items || []).map(i => [i.item_id, i.name]));
  const pbs = h.price_by_store || {};
  for (const [id, by] of Object.entries(pbs)) {
    if (rows.length >= 4) break;
    const stores = Object.entries(by).filter(([, p]) => p && p.median > 0);
    if (stores.length < 2 || !names[id]) continue;
    stores.sort((a, b) => a[1].median - b[1].median);
    const [lo, hi] = [stores[0], stores[stores.length - 1]];
    if (hi[1].median - lo[1].median < 0.25) continue;  // not worth a detour
    rows.push(`<div class="row"><span class="alertic good" aria-hidden="true">$</span><div class="grow">
      <span class="name">${esc(names[id])}: ${money(lo[1].median)} at ${esc(lo[0])}</span>
      <span class="sub">You usually pay ${money(hi[1].median)} at ${esc(hi[0])}</span></div></div>`);
  }
  return rows;
}

async function paintStoreAlerts(h) {
  const nw = await api("/api/quest/news").catch(() => ({ news: [] }));
  const rows = storeAlertRows(h, nw.news);
  // No report and no price gap yet: one labelled example, as Crew's
  // store news showed it, never dressed as real data.
  if (!rows.length) rows.push(`<div class="row"><span class="alertic" aria-hidden="true">!</span><div class="grow">
      <span class="name">Costco: Oat milk not there<span class="samplepill">Sample</span></span>
      <span class="sub">Example only. Tap Not here? on a hunt and it shows up here.</span></div></div>`);
  $("#today-alerts").innerHTML = `<h3 class="sect">Store alerts</h3><div class="group">${rows.join("")}</div>`;
}

/* "Still good?" checks (the usual-shelf-life guess) live on Today,
 * beside Use soon, since the list-first pass. */
function paintTodayChecks(h) {
  const checks = h.checks || [];
  // Eyes sightings ("in stock, left off the list") came along from
  // the List with the List overhaul: the list holds only what you add.
  const seen = (h.seen || []).map(s => `<div class="row"><div class="grow"><span class="checktext">${esc(s.name)}</span><span class="sub">Seen in the ${esc(s.kind)} · ${fmtShort(s.date)} — in stock, left off the list.</span></div></div>`);
  $("#today-checks").innerHTML = checks.length || seen.length ? `<h3 class="sect">Still good?</h3><div class="group">${checks.map(c =>
    `<div class="row"><div class="grow"><span class="checktext">${esc(c.text)}</span>
      <span class="chipset"><button class="chip" data-check-ok="${esc(c.item_id)}" type="button">Still good</button><button class="chip" data-check-expired="${esc(c.item_id)}" type="button">It expired</button></span></div></div>`).join("")}${seen.join("")}</div>` : "";
}

$("#today-checks").addEventListener("click", async ev => {
  const ok = ev.target.closest("[data-check-ok]");
  const ex = ev.target.closest("[data-check-expired]");
  if (!ok && !ex) return;
  try {
    if (ok) {
      await post("/api/list/check-ok", { item_id: ok.dataset.checkOk });
      toast("Still good — Arya will ask again next cycle.");
    } else {
      await post(`/api/items/${encodeURIComponent(ex.dataset.checkExpired)}/expired`);
      toast("Marked expired. Arya suggests it on your list.");
    }
    renderHome().catch(showErr);
  } catch (e) { toast(e.message); }
});

/* Your lists: one card per named list, what is still to get. */
function paintTodayLists(h) {
  const items = (h.list.items || []).filter(i => !i.checked && i.on_list && !i.not_grocery);
  const lists = h.lists || [];
  const cards = lists.map(l => ({ id: l.id, name: l.name, items: items.filter(i => i.list === l.id) }));
  const rest = items.filter(i => !i.list || !lists.some(l => l.id === i.list));
  if (rest.length || !cards.length) cards.push({ id: "else", name: lists.length ? "Everything else" : "Your list", items: rest });
  $("#today-lists").innerHTML = `<div class="listcards">${cards.map(c => `
    <button class="listcard" data-open-list="${esc(c.id)}" type="button"><span class="lc-name">${esc(c.name)}</span>
    <span class="lc-count">${c.items.length} item${c.items.length === 1 ? "" : "s"}</span>
    <span class="lc-items">${c.items.length ? c.items.slice(0, 3).map(i => esc(i.name)).join(", ") + (c.items.length > 3 ? "…" : "") : "Nothing to get"}</span></button>`).join("")}</div>`;
}

$("#today-lists").addEventListener("click", ev => {
  const b = ev.target.closest("[data-open-list]");
  if (!b) return;
  listLens = b.dataset.openList;
  listSel = null; listDoneOpen = false;
  show("view-list"); refresh("view-list");
});

/* Your month: the spend Analysis already shows, one line, one tap. */
let analysisFrom = "view-profile";
async function paintTodayPatterns() {
  const d = await api("/api/dashboard").catch(() => null);
  const months = d ? Object.keys(d.spend_by_month || {}).sort() : [];
  const el = $("#today-patterns");
  if (!months.length) { el.innerHTML = ""; return; }
  const k = months[months.length - 1];
  el.innerHTML = `<h3 class="sect">Your patterns</h3><button class="hubrow" id="today-patterns-btn" type="button">
    <span class="hr-label">${esc(MONTHS[Number(k.slice(5, 7)) - 1])}: ${money(d.spend_by_month[k])} spent</span><span class="hr-action">Patterns</span><span class="chev">›</span></button>`;
  $("#today-patterns-btn").addEventListener("click", () => { analysisFrom = "view-home"; show("view-analysis"); refresh("view-analysis"); });
}

async function renderHome() {
  const h = await api("/api/home");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // The header is a clock: it shows the real date, always. The
  // brain's as_of (newest data date) is a different fact and is
  // labeled as what it is — "Data through" — never dressed as
  // today (review 2026-10-28, M7).
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  $("#today-dow").textContent = `${days[now.getDay()]} · ${fmtDate(iso)}`;
  $("#today-through").textContent = h.as_of ? `Data through ${fmtDate(h.as_of)}` : "";
  paintTodayLow(h);
  paintStoreAlerts(h).catch(() => {});
  paintTodayChecks(h);
  paintTodayLists(h);
  paintTodayPatterns().catch(() => {});
  if (window.Expiry) Expiry.paintToday(h.use_soon);
  TODAY_HOME = h;
  const [q, cur] = await Promise.all([
    api("/api/review").catch(() => ({ lines: [], unresolved: [] })),
    api("/api/curator").catch(() => ({ proposals: [] }))
  ]);
  const n = (q.lines || []).length + (q.unresolved || []).length + (cur.proposals || []).length;
  $("#today-eye").innerHTML = n
    ? `<button class="hubrow" id="today-eye-btn" type="button"><span class="hr-label">Needs your eye</span><span class="countbadge">${n}</span><span class="chev">›</span></button>`
    : "";
  const eyeBtn = $("#today-eye-btn");
  if (eyeBtn) eyeBtn.addEventListener("click", () => { receiptsFrom = "view-home"; show("view-receipts"); refresh("view-receipts"); });
}

$("#today-listline").addEventListener("click", () => { show("view-list"); refresh("view-list"); });
$("#today-quest").addEventListener("click", () => { show("view-community"); refresh("view-community"); });

/* ---------------- Lists (owner, 2026-10-29: the List overhaul) ----------------
 * The tab opens on one card per list (Costco, Trader Joe's...) plus
 * "Everything else" for items on no list. Inside a list: only what the
 * household put on it. Arya's due staples are suggestions under it,
 * each with a short reason; tapping one shows why (lists.js). Swipe a
 * row for Move / Remove; Select or long-press picks several to move.
 * The old store chips and the Prepared cart are gone: the cart was one
 * Costco cart that copied the whole list (wireframe v1). */

let listLens = "home";         // "home", "else", or a named list's id
let listData = null;
let listSel = null;            // Set of picked item ids while selecting
let listRenaming = false;      // the title is an input (rename in place)
let listDoneOpen = false;      // checked rows shown, not just counted

const namedLists = () => (listData && listData.lists) || [];
const lensList = () => namedLists().find(l => l.id === listLens) || null;
const sameStore = (a, b) => (typeof qSameStore === "function" ? qSameStore(a, b)
  : String(a).toLowerCase() === String(b).toLowerCase());

/* Where an item lives: its named list, or "else". */
function itemHome(i) {
  return i.list && namedLists().some(l => l.id === i.list) ? i.list : "else";
}
/* Where a suggestion shows: the list it is filed under, else the list
 * linked to the store it is bought at most, else Everything else. */
function suggestHome(i) {
  if (i.list && namedLists().some(l => l.id === i.list)) return i.list;
  const pbs = (listData.price_by_store || {})[i.item_id] || {};
  const stores = Object.entries(pbs).sort((a, b) => b[1].count - a[1].count).map(([s]) => s);
  for (const s of stores) {
    const l = namedLists().find(l => (l.stores || []).some(x => sameStore(x, s)));
    if (l) return l.id;
  }
  return "else";
}
const onListItems = () => listData.list.items.filter(i => i.on_list);
const suggestions = () => listData.list.items.filter(i => !i.on_list);
const lensName = id => id === "else" ? "Everything else" : ((namedLists().find(l => l.id === id) || {}).name || "");

/* One short reason for a suggestion row; the sheet has the rest. */
function suggestWhy(i) {
  if (i.expired_on) return `Expired on ${fmtShort(i.expired_on)}`;
  if (i.every_days) {
    const left = i.every_days - (i.days_since || 0);
    return `Every ~${i.every_days} days · ${left <= 0 ? "due now" : `due in ${left} day${left === 1 ? "" : "s"}`}`;
  }
  return i.due_reason || i.judge_reason || "Arya thinks it's due";
}

function paintListsHome() {
  const mine = onListItems(), sugg = suggestions();
  const open = mine.filter(i => !i.checked);
  const card = (id, name, sub) => {
    const rows = open.filter(i => itemHome(i) === id);
    const n = sugg.filter(i => suggestHome(i) === id).length;
    const names = rows.slice(0, 4).map(i => i.name).join(", ") + (rows.length > 4 ? ` +${rows.length - 4}` : "");
    return `<button class="listcard" type="button" data-open-list="${esc(id)}">
      <span class="lc-top"><span class="lc-name">${esc(name)}</span><span class="lc-count">${rows.length || ""}</span><span class="chev">›</span></span>
      ${sub ? `<span class="lc-store">${esc(sub)}</span>` : ""}
      <span class="lc-items">${rows.length ? esc(names) : "Nothing on it yet"}</span>
      ${n ? `<span class="lc-sugg">${SPARK_SVG}${n} suggestion${n === 1 ? "" : "s"}</span>` : ""}</button>`;
  };
  const lists = namedLists();
  $("#list-cards").innerHTML = lists.map(l =>
    card(l.id, l.name, (l.stores || []).length ? (l.stores.length === 1 && sameStore(l.stores[0], l.name) ? "" : l.stores.join(" · ")) : "No store linked")).join("") +
    card("else", "Everything else", lists.length ? "Not on a list yet" : "Make a list for each store you shop at");
  const used = new Set(open.map(itemHome)).size;
  $("#list-line").textContent = open.length
    ? `${open.length} thing${open.length === 1 ? "" : "s"} to get${used > 1 ? ` across ${used} lists` : ""}`
    : "Nothing to get yet";
}

function listRow(i) {
  const picking = !!listSel;
  const picked = picking && listSel.has(i.item_id);
  const sub = i.added_by ? `Added by ${i.added_by}` : "";
  return `<div class="swipewrap" data-wrap-id="${esc(i.item_id)}">
  <div class="acts" aria-hidden="true"><button type="button" class="mv" data-act="move" data-id="${esc(i.item_id)}" tabindex="-1">Move</button><button type="button" class="rm" data-act="remove" data-id="${esc(i.item_id)}" tabindex="-1">Remove</button></div>
  <div class="row listrow${i.checked ? " checked" : ""}${picked ? " picked" : ""}" tabindex="0" data-row-id="${esc(i.item_id)}">
    ${picking ? `<span class="pick" data-act="pick" data-id="${esc(i.item_id)}">${CHECK_SVG}</span>`
      : `<button class="check" data-act="check" data-id="${esc(i.item_id)}" aria-label="Check off ${esc(i.name)}">${CHECK_SVG}</button>`}
    <div class="grow">${picking ? `<span class="name">${esc(i.name)}</span>` : `<a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a>`}
    ${sub ? `<span class="sub">${esc(sub)}</span>` : ""}
    ${(window.qAskLaterHas && qAskLaterHas(i.name)) ? `<span class="sub asklater">To ask — kept as typed; asked again at the next plan.</span>` : ""}
    ${i.not_grocery && !picking ? `<span class="sub notgrocery">Not a grocery item? Added anyway. <button class="linkbtn" data-act="ng-keep" data-id="${esc(i.item_id)}">It is groceries</button> · <button class="linkbtn" data-act="ng-remove" data-id="${esc(i.item_id)}">Remove</button></span>` : ""}</div>
    ${picking ? "" : `<button class="qtybtn" data-act="qty" data-id="${esc(i.item_id)}" aria-label="Quantity ${esc(qtyTag(i) || "1")}. Tap to change.">${i.unit ? esc(qtyFmt(i.qty) + " " + i.unit) : "× " + qtyFmt(i.qty)}</button>`}
  </div></div>`;
}

function suggestRow(i) {
  const c = charFor(i.name);
  return `<div class="row sugrow" data-why="${esc(i.item_id)}" tabindex="0" role="button" aria-label="Why Arya suggests ${esc(i.name)}">
    ${c ? `<img class="rowface" src="assets/characters/${c}" alt="">` : ""}
    <div class="grow"><span class="name">${esc(i.name)}</span><span class="why">${SPARK_SVG}${esc(suggestWhy(i))}</span></div>
    <button class="addchip" type="button" data-sugg-add="${esc(i.item_id)}" aria-label="Add ${esc(i.name)}">+ Add</button></div>`;
}

function paintListPage() {
  const here = lensList();
  const id = here ? here.id : "else";
  const name = lensName(id);
  const rows = onListItems().filter(i => itemHome(i) === id);
  const open = rows.filter(i => !i.checked), done = rows.filter(i => i.checked);
  const groceries = open.filter(i => !i.not_grocery), errands = open.filter(i => i.not_grocery);
  if (listSel) for (const x of [...listSel]) if (!open.some(i => i.item_id === x)) listSel.delete(x);
  // The pencil sits on the name itself (owner, 2026-10-29): tap it to
  // rename in place. Everything else has no name to change.
  if (!listRenaming) $("#lp-title").innerHTML = here && !listSel
    ? `<span id="lp-name">${esc(name)}</span><button class="pen" id="lp-pen" type="button" aria-label="Rename ${esc(name)}">${PEN_SVG}</button>`
    : esc(name);
  $("#lp-sub").textContent = listSel ? `${listSel.size} selected`
    : [open.length ? `${open.length} to get` : "Nothing to get", ...((here && here.stores) || [])].join(" · ");
  $("#lp-select").textContent = listRenaming ? "Save" : listSel ? "Done" : "Select";
  $("#lp-select").hidden = !listRenaming && !listSel && !open.length;
  $("#lp-menu").hidden = !here || !!listSel || listRenaming;
  $("#composer").hidden = !!listSel;
  const field = $("#add-text");
  field.placeholder = name.length <= 8 ? `Add to ${name}` : "Add an item";
  field.setAttribute("aria-label", `Add to ${name}`);
  const box = $("#smart-list");
  box.innerHTML = (groceries.length ? `<div class="group">${groceries.map(listRow).join("")}</div>`
      : errands.length ? "" : `<div class="group pad"><div class="emptyface-wrap"><img class="emptyface" src="assets/characters/pantry.webp" alt="">${empty(`Nothing on ${esc(name)} yet. Type, speak or snap a list above.`)}</div></div>`) +
    (errands.length ? `<p class="grouplabel">Other errands</p><div class="group">${errands.map(listRow).join("")}</div>` : "");
  bindItemLinks(box);
  const sugg = listSel ? [] : suggestions().filter(i => suggestHome(i) === id);
  $("#list-suggest").innerHTML = sugg.length
    ? `<div class="sectrow"><h3 class="sect">${id === "else" ? "Suggested" : `Suggested for ${esc(name)}`}</h3><span class="muted">Tap to see why</span></div><div class="group">${sugg.map(suggestRow).join("")}</div>` : "";
  $("#list-done").innerHTML = done.length && !listSel
    ? `<div class="group"><div class="row donerow"><button class="linkbtn donetoggle" type="button" data-done-toggle aria-expanded="${listDoneOpen}">✓ ${done.length} checked off ${listDoneOpen ? "▴" : "▾"}</button><button class="linkbtn" type="button" data-done-clear>Clear</button></div>${listDoneOpen ? done.map(listRow).join("") : ""}</div>` : "";
  bindItemLinks($("#list-done"));
  $("#list-hunt").hidden = !here || !!listSel || !open.length;
  $("#list-selbar").hidden = !listSel;
  if (listSel) $("#ls-move").textContent = listSel.size ? `Move ${listSel.size} to…` : "Move to…";
  $("#ls-move").disabled = $("#ls-remove").disabled = !(listSel && listSel.size);
  document.body.classList.toggle("selecting", !!listSel);
}

function paintListGroups() {
  const home = listLens === "home";
  if (!home && listLens !== "else" && !lensList()) listLens = "home";
  $("#lists-home").hidden = listLens !== "home";
  $("#list-page").hidden = listLens === "home";
  if (listLens === "home") { listSel = null; document.body.classList.remove("selecting"); $("#list-selbar").hidden = true; paintListsHome(); }
  else paintListPage();
}

function openListLens(id) {
  listLens = id; listSel = null; listDoneOpen = false; listRenaming = false;
  paintListGroups();
  window.scrollTo(0, 0);
}

$("#list-cards").addEventListener("click", ev => {
  const b = ev.target.closest("[data-open-list]");
  if (b) openListLens(b.dataset.openList);
});
$("#list-back").addEventListener("click", () => openListLens("home"));
$("#lp-select").addEventListener("click", () => {
  if (listRenaming) { if (window.ListSheets) ListSheets.saveTitle().catch(e => toast(e.message)); return; }
  listSel = listSel ? null : new Set();
  paintListPage();
});
$("#ls-remove").addEventListener("click", () => {
  if (listSel && listSel.size) removeListItems([...listSel]);
});
$("#ls-move").addEventListener("click", () => {
  if (listSel && listSel.size && window.ListSheets) ListSheets.openMove([...listSel]);
});
$("#list-hunt").addEventListener("click", () => {
  const l = lensList();
  if (l && typeof startHuntFromList === "function") startHuntFromList(l);
});
$("#list-done").addEventListener("click", async ev => {
  if (ev.target.closest("[data-done-toggle]")) { listDoneOpen = !listDoneOpen; paintListPage(); return; }
  if (ev.target.closest("[data-done-clear]")) {
    const id = lensList() ? lensList().id : "else";
    const ids = onListItems().filter(i => i.checked && itemHome(i) === id).map(i => i.item_id);
    removeListItems(ids);
  }
});
$("#list-suggest").addEventListener("click", async ev => {
  const add = ev.target.closest("[data-sugg-add]");
  if (add) { ev.stopPropagation(); addSuggestion(add.dataset.suggAdd); return; }
  const r = ev.target.closest("[data-why]");
  if (r && window.ListSheets) ListSheets.openWhy(r.dataset.why);
});
$("#list-suggest").addEventListener("keydown", ev => {
  const r = ev.target.closest && ev.target.closest("[data-why]");
  if (r && ev.target === r && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); if (window.ListSheets) ListSheets.openWhy(r.dataset.why); }
});

/* + Add on a suggestion: it joins the list it was suggested for. */
async function addSuggestion(id) {
  const it = listItems[id];
  const target = it ? suggestHome(it) : "else";
  try {
    await post("/api/list/add", target === "else" ? { item_id: id } : { item_id: id, list_id: target });
    await renderList();
    toast(`Added ${it ? it.name : "it"} to ${lensName(target)}.`, { action: "Undo", onAction: async () => {
      // Back to a suggestion: not on the list, and not dismissed either.
      try { await post(`/api/items/${encodeURIComponent(id)}/flag`, { manual: false, list: it ? it.list || null : null }); renderList().catch(showErr); }
      catch (e) { toast(e.message); }
    } });
  } catch (e) { toast(e.message); }
}

/* The list-row actions (check / stepper / remove). The endpoints
 * always existed; the Stage 6 file split dropped these handlers —
 * restored here, one delegation for every lens. */
$("#smart-list").addEventListener("click", async ev => {
  if (listSel) {
    const r = ev.target.closest(".listrow");
    if (!r) return;
    const id = r.dataset.rowId;
    if (listSel.has(id)) listSel.delete(id); else listSel.add(id);
    paintListPage();
    return;
  }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, item = listItems[id];
  try {
    if (b.dataset.act === "check") {
      await post("/api/list/check", { item_id: id, checked: !(item && item.checked) });
    } else if (b.dataset.act === "qty") {
      editQty(b, id, item);
      return;
    } else if (b.dataset.act === "ng-keep") {
      await post("/api/list/grocery-verdict", { item_id: id, kind: "grocery" });
    } else if (b.dataset.act === "ng-remove" || b.dataset.act === "remove") {
      await removeListItem(id);
      return;
    } else if (b.dataset.act === "move") {
      if (window.ListSheets) ListSheets.openMove([id]);
      return;
    } else return;
    renderList().catch(showErr);
  } catch (e) { toast(e.message); }
});

/* Tap the amount to change it: the button swaps for a number
 * field; Enter or leaving the field saves. */
function editQty(btn, id, item) {
  const wrap = document.createElement("span");
  wrap.className = "qtyedit";
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "1"; inp.step = "1"; inp.inputMode = "numeric";
  inp.className = "qtyinput"; inp.value = item ? Number(item.qty) || 1 : 1;
  inp.setAttribute("aria-label", "Quantity");
  // The unit is free text ("kg", "L", "bunch"): no list, no conversion.
  const unit = document.createElement("input");
  unit.type = "text"; unit.maxLength = 16; unit.autocomplete = "off";
  unit.className = "qtyinput qtyunit"; unit.placeholder = "unit";
  unit.value = (item && item.unit) || "";
  unit.setAttribute("aria-label", "Unit, for example kg or L");
  wrap.append(inp, unit);
  btn.replaceWith(wrap);
  inp.focus(); inp.select();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const q = Math.max(1, Math.round(Number(inp.value) || 1));
    const u = unit.value.trim();
    try {
      if (!item || q !== Number(item.qty) || u !== (item.unit || "")) await post("/api/list/qty", { item_id: id, qty: q, unit: u });
    }
    catch (e) { toast(e.message); }
    renderList().catch(showErr);
  };
  // Leaving both fields saves; tabbing from the number to the unit does not.
  wrap.addEventListener("focusout", ev => { if (!wrap.contains(ev.relatedTarget)) commit(); });
  wrap.addEventListener("keydown", ev => {
    if (ev.key === "Enter") { ev.preventDefault(); commit(); }
    if (ev.key === "Escape") { done = true; renderList().catch(showErr); }
  });
}

/* Remove with Undo (swipe → Remove, Delete on a focused row, Select →
 * Remove, or Clear on checked rows). The remove endpoint only
 * dismisses, so Undo is an add by id; the list filing stays put. */
async function removeListItems(ids) {
  if (!ids.length) return;
  const names = ids.map(id => (listItems[id] || {}).name || "Item");
  try {
    for (const id of ids) await post("/api/list/remove", { item_id: id });
    if (listSel) listSel = null;
    renderList().catch(showErr);
    toast(ids.length === 1 ? `${names[0]} removed.` : `${ids.length} items removed.`, { action: "Undo", onAction: async () => {
      try { for (const id of ids) await post("/api/list/add", { item_id: id }); renderList().catch(showErr); }
      catch (e) { toast(e.message); }
    } });
  } catch (e) { toast(e.message); }
}
const removeListItem = id => removeListItems([id]);

/* Swipe a row left to show Move and Remove (it no longer removes on
 * its own). Long-press a row to start selecting with it picked. */
(function wireListSwipe() {
  const box = $("#smart-list");
  const OPEN = -160;
  let row = null, x0 = 0, y0 = 0, dx = 0, lock = null, base = 0, press = null;
  const closeAll = except => box.querySelectorAll(".swipewrap.open").forEach(w => {
    if (w !== except) { w.classList.remove("open"); w.querySelector(".listrow").style.transform = ""; }
  });
  box.addEventListener("touchstart", ev => {
    row = ev.target.closest(".listrow");
    if (!row || ev.target.closest("input") || listSel) { row = null; return; }
    const wrap = row.closest(".swipewrap");
    closeAll(wrap);
    base = wrap.classList.contains("open") ? OPEN : 0;
    x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dx = 0; lock = null;
    clearTimeout(press);
    const id = row.dataset.rowId;
    press = setTimeout(() => { if (!lock) { row = null; startSelect(id); } }, 550);
  }, { passive: true });
  box.addEventListener("touchmove", ev => {
    if (!row) return;
    const mx = ev.touches[0].clientX - x0, my = ev.touches[0].clientY - y0;
    if (!lock && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { lock = Math.abs(mx) > Math.abs(my) * 1.5 ? "x" : "y"; clearTimeout(press); }
    if (lock !== "x") return;
    dx = Math.max(OPEN - 40, Math.min(0, base + mx));
    row.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  const end = () => {
    clearTimeout(press);
    if (!row) return;
    const r = row, wrap = r.closest(".swipewrap"); row = null;
    if (lock !== "x") return;
    const open = dx < OPEN / 2;
    wrap.classList.toggle("open", open);
    r.style.transform = open ? `translateX(${OPEN}px)` : "";
  };
  box.addEventListener("touchend", end);
  box.addEventListener("touchcancel", () => { clearTimeout(press); if (row) { row.style.transform = ""; row = null; } });
  box.addEventListener("contextmenu", ev => { if (ev.target.closest(".listrow")) ev.preventDefault(); });
  document.addEventListener("click", ev => { if (!ev.target.closest(".swipewrap.open")) closeAll(null); });
  box.addEventListener("keydown", ev => {
    const r = ev.target.closest && ev.target.closest(".listrow");
    if (r && ev.target === r && (ev.key === "Delete" || ev.key === "Backspace")) { ev.preventDefault(); removeListItem(r.dataset.rowId); }
  });
})();

function startSelect(id) {
  listSel = new Set(id ? [id] : []);
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* no haptics */ }
  paintListPage();
}


async function renderList() {
  // A slow home payload must never face the user with the
  // previous list (or a blank): say what is happening (review M9).
  if (!listData) $("#list-cards").innerHTML = empty("Loading your list…");
  const h = await api("/api/home");
  listData = h;
  listItems = Object.fromEntries(h.list.items.map(i => [i.item_id, i]));
  paintListGroups();
}

const SETUP_PROMPT = `You are connected to my Arya — my grocery assistant at https://arya-pilot.duckdns.org. Arya keeps a living model of my purchases, inventory and shopping list.

Your job when I talk to you:
- A receipt photo or PDF, or a pasted order (Instacart, Amazon, an email): read it and file it in Arya as structured data — merchant, date, each line (name, quantity, price, line total), subtotal, tax, total. Leave delivery fees and tips out. Report back the total Arya verified, never your own arithmetic.
- Questions about my list, my spending, or whether something expired: answer from Arya's data, not from memory of our chats.
- A fridge or pantry photo: file it as a sighting. Arya asks me to confirm any change.
- Anything else: answer normally. Bring Arya in only when my message is about my groceries, receipts, spending or list.

Rules: never guess a product name you cannot read — flag it and let Arya queue it for me. If a name is unknown, check the retailer's own online catalog, propose the match with its source, and wait for my word before settling it. Returns are refunds, never purchases.

My connector token lives in your secure credential store — the one I pasted when we set this up. Send it as a Bearer token and never print it.`;

document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-copy-prompt]");
  if (!b) return;
  if (navigator.clipboard) navigator.clipboard.writeText(SETUP_PROMPT);
  toast("Setup prompt copied.");
});

/* ---------------- Connector token (Profile + first run) ---------------- */

async function paintTokenRow(el) {
  if (!el) return;
  let has = false;
  try { has = (await api("/auth/token")).has_token; } catch (e) { el.innerHTML = ""; return; }
  el.innerHTML = `${has ? `<span class="sub grow">Your link code is active.</span>` : `<span class="sub grow">No link code yet.</span>`}<button class="btn" data-mint="1">${has ? "Make a new code" : "Make my link code"}</button>${has ? `<button class="btn danger" data-revoke="1">Revoke</button>` : ""}`;
}

async function mintInto(el) {
  try {
    const t = await post("/auth/token");
    el.innerHTML = `<input class="grow" data-token-value readonly value="${esc(t.token)}"><button class="btn" data-copy="1">Copy</button>
      <span class="sub">Copy it now — it is not shown again. Paste it into Muse's secure form.</span>`;
  } catch (e) { toast(e.message); }
}

document.addEventListener("click", async ev => {
  const rowEl = ev.target.closest("#profile-token-row");
  if (!rowEl) return;
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.mint) mintInto(rowEl);
  else if (b.dataset.copy) {
    const i = rowEl.querySelector("[data-token-value]"); i.select();
    if (navigator.clipboard) navigator.clipboard.writeText(i.value);
    toast("Token copied.");
  } else if (b.dataset.revoke) {
    try { await api("/auth/token", { method: "DELETE" }); toast("Link code revoked."); paintTokenRow(rowEl); }
    catch (e) { toast(e.message); }
  }
});

/* ---------------- Profile ---------------- */

/* One unified Profile (B6): the Quest player card (handle, stats,
 * badge shelf, mapper credits, Eagle Eye + spots) merged with the
 * account Profile (account, Muse token card, receipt count).
 * There is no second, brain-only profile. The app is light theme
 * only (owner 2026-10-27) — there is no theme switch. */
async function renderProfile() {
  await loadCurrency();
  $("#profile-account").innerHTML = row("Signed in as", "", esc(isDemo ? "demo" : (window.__aryaUser || "")))
    + `<div class="row"><div class="grow"><span class="name">Currency</span><span class="sub">How prices show. Arya does not convert.</span></div>
      <select id="pf-currency" class="curpick" aria-label="Currency">${["USD", "EUR", "GBP", "INR", "CAD", "AUD"].map(c =>
        `<option value="${c}"${c === CURRENCY.code ? " selected" : ""}>${esc(CURRENCY_SYMBOLS[c])} ${c}</option>`).join("")}</select></div>`;
  $("#pf-currency").addEventListener("change", async ev => {
    try {
      const s = await post("/api/settings", { currency: ev.target.value });
      CURRENCY = { code: s.currency, symbol: s.symbol };
      toast(`Prices now show in ${s.currency}.`);
    } catch (e) { toast(e.message); ev.target.value = CURRENCY.code; }
  });
  paintTokenRow($("#profile-token-row"));
  const [profile, archive] = await Promise.all([
    api("/api/quest/profile").catch(() => null),
    api("/api/quest/receipts").catch(() => ({ receipts: [] }))
  ]);
  $("#pf-receipts-sub").textContent = archive.receipts.length
    ? `${archive.receipts.length} receipts · the private archive` : "The private archive";
  if (!profile) {
    $("#pf-handle").textContent = "";
    $("#pf-level").textContent = "";
    $("#pf-quest-sub").textContent = "Hunts, badges and mapped stores";
    $("#pf-stats").innerHTML = "";
    $("#pf-spots").innerHTML = "";
    $("#pf-badges").innerHTML = "";
    $("#pf-stores").innerHTML = "";
    return;
  }
  const s = profile.stats;
  $("#pf-handle").textContent = "@" + profile.handle;
  const earned = (profile.badges || []).filter(b => b.earned).length;
  $("#pf-level").textContent = `Level ${profile.level || 1} · ${profile.points || 0} pts`
    + (s.streak_weeks ? ` · ${s.streak_weeks} wk streak` : "");
  $("#pf-quest-sub").textContent = `${s.hunts} hunt${s.hunts === 1 ? "" : "s"} · ${earned} of ${(profile.badges || []).length} badges`
    + ((profile.mapped_stores || []).length ? ` · ${profile.mapped_stores.length} store${profile.mapped_stores.length === 1 ? "" : "s"} mapped` : "");
  $("#pf-stats").innerHTML =
    `<div class="stattile"><div class="sv">${s.hunts + (archive.unsettled || []).length}</div><div class="sl">Hunts finished</div></div>
     <div class="stattile"><div class="sv">${s.hunts}</div><div class="sl">Receipt attached</div></div>
     <div class="stattile"><div class="sv">${profile.level || 1}</div><div class="sl">Level · ${profile.points || 0} pts</div></div>
     <div class="stattile"><div class="sv">${s.receipts}</div><div class="sl">Receipts</div></div>
     <div class="stattile"><div class="sv">${s.streak_weeks} wk${s.streak_weeks === 1 ? "" : "s"}</div><div class="sl">Streak</div></div>`;
  paintMissingReceipts($("#pf-missing"), archive.unsettled || [], () => renderProfile().catch(showErr));
  const eagle = (profile.badges || []).find(b => b.id === "eagle_eye");
  $("#pf-spots").innerHTML =
    row("Store changes you spotted", "Points land only when a change is verified", String(s.spots_reported || 0)) +
    (eagle ? row("Eagle Eye", esc(eagle.detail || eagle.criteria), eagle.earned ? "Earned ✓" : "Locked") : "");
  if (window.qMarkBadgesSeen) qMarkBadgesSeen(profile.badges);
  $("#pf-badges").innerHTML = (profile.badges || []).map(b =>
    `<div class="badgetile${b.earned ? "" : " locked"}">${BADGE_ART[b.id] ? `<img class="bdgimg" src="assets/characters/${BADGE_ART[b.id]}" alt="">` : ""}<h4>${esc(b.name)}</h4><p>${esc(b.criteria)}</p>
     <span class="b-state">${b.earned ? "Earned ✓" : `Locked · ${esc(b.detail || "")}`}</span></div>`).join("");
  $("#pf-stores").innerHTML = profile.mapped_stores && profile.mapped_stores.length
    ? profile.mapped_stores.map(st => row(esc(st), "Mapped by you", "✓")).join("")
    : empty("No stores mapped yet. Mapping a store is how its 3D view gets built.");
}

$("#btn-analysis").addEventListener("click", () => { show("view-analysis"); refresh("view-analysis"); });
/* Quest progress, Connect Muse and About are one tap from Profile
 * (owner, 2026-10-29: Profile too busy). Each Back lands on Profile. */
for (const [btn, view, back] of [["#btn-quest-progress", "view-quest-progress", "#pfq-back"],
    ["#btn-muse", "view-muse", "#pfm-back"], ["#btn-about", "view-about", "#pfa-back"]]) {
  $(btn).addEventListener("click", () => { show(view); refresh(view); });
  $(back).addEventListener("click", ev => { ev.preventDefault(); show("view-profile"); refresh("view-profile"); });
}
/* Analysis is reached only from Profile, and the wireframe's back
 * arrow returns there — not through the quest view stack. */
$("#an-back").addEventListener("click", ev => { ev.preventDefault(); const to = analysisFrom; analysisFrom = "view-profile"; show(to); refresh(to); });
$("#btn-receipts").addEventListener("click", () => { receiptsFrom = "view-profile"; show("view-receipts"); refresh("view-receipts"); });
// Receipts back returns to the Brain view that opened it,
// through that tab's own entry so tab state stays in sync.
$("#rc-back").addEventListener("click", ev => { ev.preventDefault();
  // Profile is not a tab: fall back to showing the view directly.
  const tab = document.querySelector(`.tab[data-view="${receiptsFrom}"]`);
  if (tab) tab.click(); else { show(receiptsFrom); refresh(receiptsFrom); } });

/* Feature request / Contact us (Profile): one note, a kind, the
 * username rides the session. Demo visitors see the form but the
 * server refuses their send; the owner also sees what came in. */
let fbKind = "idea";
$("#btn-feedback").addEventListener("click", () => {
  show("view-feedback");
  $("#fb-status").textContent = isDemo ? "Sign in with a real account to send a note." : "";
  $("#fb-send").disabled = isDemo;
  paintFeedbackInbox().catch(() => {});
});
$("#fb-back").addEventListener("click", ev => { ev.preventDefault(); show("view-profile"); refresh("view-profile"); });

/* Account exit doors (Tranche 1a): export is a plain link in the
 * Profile markup; delete asks for the password inline, then the
 * server erases the account and clears the session cookie. */
$("#btn-del-account").addEventListener("click", () => {
  const box = $("#del-account-box");
  box.hidden = !box.hidden;
  if (!box.hidden) $("#del-account-pw").focus();
});
$("#btn-del-account-go").addEventListener("click", async () => {
  const pw = $("#del-account-pw").value;
  if (!pw) { toast("Enter your password to confirm."); return; }
  try {
    await post("/auth/account/delete", { password: pw });
    location.href = "/";
  } catch (e) { toast(e.message); }
});
$("#fb-kinds").addEventListener("click", ev => {
  const b = ev.target.closest("[data-kind]");
  if (!b) return;
  fbKind = b.dataset.kind;
  document.querySelectorAll("#fb-kinds [data-kind]").forEach(x =>
    x.setAttribute("aria-pressed", String(x === b)));
});
$("#fb-text").addEventListener("input", () => {
  $("#fb-count").textContent = `${$("#fb-text").value.length} / 1000`;
});
$("#fb-send").addEventListener("click", async () => {
  const btn = $("#fb-send");
  btn.disabled = true;
  try {
    await post("/api/feedback", { kind: fbKind, text: $("#fb-text").value });
    $("#fb-text").value = "";
    $("#fb-count").textContent = "0 / 1000";
    $("#fb-status").textContent = "Sent. Thank you.";
    paintFeedbackInbox().catch(() => {});
  } catch (e) { $("#fb-status").textContent = e.message; }
  btn.disabled = false;
});
async function paintFeedbackInbox() {
  const box = $("#fb-owner");
  let d;
  try { d = await api("/api/feedback"); } catch (e) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<h3 class="sect">Received</h3><div class="group">` + (d.notes.length
    ? d.notes.map(n => row(esc(n.text), `${esc(n.kind)} · ${esc(n.user)} · ${new Date(n.at * 1000).toLocaleDateString()}`, "")).join("")
    : empty("Nothing yet.")) + `</div>`;
}

$("#btn-signout2").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});

/* ---------------- Add: one surface for the list ----------------
 * Add is for the list (owner clarification 2026-10-27): one text
 * field that takes typing and paste alike, a mic (Muse Voice
 * Transcribe lands in the field for edit), and a camera. The
 * camera is smart: a list photo adds its items; a receipt photo
 * adds nothing — it offers to file the receipt instead (receipts
 * enter by image only, through /decode/photo). In the demo, the
 * camera and mic call the Meta API live and persist nothing: the
 * read lands in the text field as a preview, and the field itself
 * stays disabled. */

/* Microphone capture -> mono 16-bit PCM WAV at 16 kHz, the Meta ASR
 * batch endpoint's input contract. Browsers cannot record WAV
 * natively, so the PCM is encoded here from the Web Audio stream. */
async function startCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = ev => chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  src.connect(proc);
  proc.connect(ctx.destination);
  return {
    stop() {
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach(t => t.stop());
      const wav = encodeWav(chunks, ctx.sampleRate);
      ctx.close();
      return wav;
    }
  };
}

function encodeWav(chunks, srcRate) {
  const target = 16000;
  let len = 0;
  chunks.forEach(c => { len += c.length; });
  const flat = new Float32Array(len);
  let off = 0;
  chunks.forEach(c => { flat.set(c, off); off += c.length; });
  const ratio = srcRate / target;
  const n = Math.floor(flat.length / ratio);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, target, true);
  v.setUint32(28, target * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, flat[Math.floor(i * ratio)]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

async function transcribeBlob(wav) {
  const r = await fetch("/api/transcribe", {
    method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return (await r.json()).text || "";
}

/* One toggle-record button: tap to start, tap again to stop and
 * transcribe. onText receives the transcript. */
function wireRecordButton(btn, statusEl, onText) {
  let capture = null;
  const label = btn.innerHTML;
  const iconOnly = btn.classList.contains("iconbtn");
  btn.addEventListener("click", async () => {
    if (capture) {
      const wav = capture.stop();
      capture = null;
      btn.classList.remove("listening");
      btn.innerHTML = label;
      statusEl.textContent = "Transcribing with Muse Voice Transcribe…";
      try {
        const text = await transcribeBlob(wav);
        statusEl.textContent = text ? "" : "That did not come through. Try again, closer to the mic.";
        if (text) onText(text);
      } catch (e) {
        statusEl.textContent = "";
        toast("Transcription failed: " + e.message);
      }
      return;
    }
    if (!navigator.mediaDevices || !(window.AudioContext || window.webkitAudioContext)) {
      statusEl.textContent = "Voice input is not available in this browser. The microphone on your keyboard works too.";
      return;
    }
    try {
      capture = await startCapture();
      btn.classList.add("listening");
      if (!iconOnly) btn.textContent = "Stop & transcribe";
      statusEl.textContent = "Listening…";
    } catch (e) {
      statusEl.textContent = "Microphone access was refused. You can type instead.";
    }
  });
}

async function renderIntake() {
  const field = $("#add-text");
  if (!field) return;
  // The demo bar already says changes reset; the List stays quiet
  // (List overhaul: the demo hint wrapped three lines over the list,
  // and the owner dropped the Meta-model and Muse footer lines).
}

/* File a receipt photo (image only): the one receipt path the
 * Receipts view and the Add camera's receipt offer share. */
async function fileReceiptPhoto(file, statusEl, previewEl) {
  statusEl.textContent = "Reading the receipt — this can take up to a minute.";
  if (previewEl) previewEl.innerHTML = "";
  try {
    const r = await fetch("/decode/photo", {
      method: "POST",
      headers: { "Content-Type": file.type || "image/jpeg" },
      body: file
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
    const out = await r.json();
    const rec = out.receipt || {};
    statusEl.textContent = "";
    if (out.demo) {
      if (previewEl) previewEl.innerHTML = `<div class="group pad" style="margin-top:10px">
        <p class="nomargin"><strong>${esc(rec.merchant || "Receipt")}</strong> <span class="sub">read live · kept for this demo visit only</span></p>
        ${(rec.lines || []).map(l => row(esc(l.decoded_name || l.raw || "line"), "", l.line_total != null ? money(l.line_total) : "")).join("")}
        ${rec.total != null ? row("Total", "", money(rec.total)) : ""}</div>`;
      else statusEl.textContent = "Read live — kept for this demo visit only.";
    } else {
      toast(`Filed ${rec.merchant || "the receipt"} — ${(rec.lines || []).length} lines. Anything unsure is in Receipts, under Needs your eye.`);
      renderScan().catch(showErr);
    }
  } catch (e) {
    statusEl.textContent = "";
    toast("Could not read that photo: " + e.message);
  }
}

/* After an add, bring the new rows into view and flash them: the
 * add box sits above the fold of a long list, so a toast alone
 * left first-time users unsure anything happened. */
function flashNewRows(names) {
  const want = new Set((names || []).map(n => String(n).toLowerCase()));
  const rows = [...document.querySelectorAll("#view-list .listrow")]
    .filter(r => want.has((r.querySelector(".name")?.textContent || "").trim().toLowerCase()));
  if (!rows.length) return;
  rows.forEach(r => { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); });
  rows[0].scrollIntoView({ block: "center", behavior: "smooth" });
}

/* Names the rules do not know get one cached model look, after the
 * add has already landed. A flagged item shows its chip; nothing is
 * ever removed for the user. A failure is silent: unknown stays a
 * normal grocery row. */
async function judgeUnknownItems() {
  try {
    const r = await post("/api/list/judge", {});
    if (r.flagged && r.flagged.length) renderList().catch(() => {});
  } catch (e) { /* unknown stays groceries */ }
}

let addBound = false;
function bindAdd() {
  if (addBound) return;
  addBound = true;

  $("#add-submit").addEventListener("click", async () => {
    const field = $("#add-text");
    const text = field.value.trim();
    if (!text) { toast("Type or paste the items first."); return; }
    const btn = $("#add-submit");
    btn.disabled = true;
    try {
      const here = lensList();
      // One field for adding and asking (owner, 2026-10-29): "add naan
      // to Indian Store" files it ($0, no model); a question or a
      // command ("I'm out of milk") goes to Arya; anything else is an
      // item. Adds from Arya apply at once and offer Undo.
      const parsed = AryaAsk.parseAddToList(text, namedLists());
      if (parsed || AryaAsk.looksLikeAsk(text)) {
        field.value = ""; paintAddSplit();
        const box = $("#list-answer");
        if (parsed) await AryaAsk.addToList(box, text, parsed, () => { renderList().catch(() => {}); });
        else await AryaAsk.run(text, { box, surface: "list",
          context: here ? { list: here.name, list_id: here.id } : {},
          onChange: () => { renderList().catch(() => {}); } });
        btn.disabled = false;
        return;
      }
      const r = await post("/api/list/from-text", here ? { text, list_id: here.id } : { text });
      // Text typed while the request ran stays; only the sent text clears.
      if (field.value.trim() === text) field.value = "";
      paintAddSplit();
      $("#add-status").textContent = "";
      const dup = r.already ? ` ${r.already} already on it.` : "";
      const skip = (r.skipped || []).length
        ? ` Left out (not items): ${r.skipped.join(", ")}.` : "";
      const where = here ? here.name : "your list";
      toast((r.added === 1 ? `Added 1 item to ${where}.`
        : `Added ${r.added} items to ${where}.`) + dup + skip);
      renderList().then(() => flashNewRows(r.names)).catch(() => {});
      judgeUnknownItems();
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  });

  /* The split preview (owner wireframe, 2026-10-28): what the field
   * will add, shown as chips before anything is added. Mirrors the
   * server split (lines/semicolons, then commas; bullets and
   * numbering stripped; duplicates collapsed) — the server stays
   * the authority; removing a chip rewrites the field. */
  /* Mirrors the server split (api/list/intake.py) — the server
   * stays the authority. Sentence smarts (owner's phone, 2026-10-28):
   * dictation lead-ins ("i need some") strip, a sentence's "and"s
   * split, duplicates fold; a plain line never splits, so
   * "mac and cheese" stays one item in the chips too. */
  const ADD_LEAD = /^(please get |please buy |please add |add |buy |get |and |i need some |i need |we need some |we need |i want some |i want |get me some |get me )/i;
  function splitPreview(text) {
    const out = [], seen = new Set();
    for (const chunk of String(text || "").split(/[\n;]+/)) {
      const low = chunk.trim().toLowerCase();
      const sentence = chunk.includes(",") || ADD_LEAD.test(low)
        || (low.match(/ and /g) || []).length >= 2;
      let pieces = chunk.split(",");
      if (sentence) pieces = pieces.flatMap(p => p.split(/\s+and\s+/i));
      for (let piece of pieces) {
        let name = piece.replace(/^[\s•\-*☐☑✓\d.)]+/, "").trim();
        name = name.replace(/^(oh|okay|ok|so|well|um|uh|hmm)[,\s]+/i, "").replace(ADD_LEAD, "");
        if (/^(oh|okay|ok|so|well|um|uh|hmm)$/i.test(name)) name = "";
        if (name.toLowerCase().startsWith("some ")) name = name.slice(5);
        name = name.replace(/\s*[x×]\s*\d+\s*$/, "").replace(/[.!]+$/, "").trim();
        if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
      }
    }
    return out;
  }
  function paintAddSplit() {
    const box = $("#add-split"), field = $("#add-text"), btn = $("#add-submit");
    if (!box || !field) return;
    const items = splitPreview(field.value);
    box.hidden = items.length < 2;
    box.innerHTML = items.map((n, i) =>
      `<span class="spchip">${esc(n)}<button type="button" data-spx="${i}" aria-label="Remove ${esc(n)}">×</button></span>`).join("");
    const asking = AryaAsk.looksLikeAsk(field.value) || !!AryaAsk.parseAddToList(field.value, namedLists());
    if (btn) btn.textContent = asking ? (AryaAsk.looksLikeAsk(field.value) ? "Ask" : "Add") : (items.length > 1 ? `Add ${items.length} items` : "Add");
    field.classList.toggle("askish", AryaAsk.looksLikeAsk(field.value));
    // A question or command is not an item list: no split chips.
    if (AryaAsk.looksLikeAsk(field.value) || AryaAsk.parseAddToList(field.value, namedLists())) box.hidden = true;
  }
  $("#add-text").addEventListener("input", paintAddSplit);
  $("#add-split").addEventListener("click", ev => {
    const b = ev.target.closest("[data-spx]");
    if (!b) return;
    const items = splitPreview($("#add-text").value);
    items.splice(Number(b.dataset.spx), 1);
    $("#add-text").value = items.join("; ");
    paintAddSplit();
  });
  /* The field is one line now, and a one-line input flattens a pasted
   * list's line breaks. Keep them as semicolons, which the server
   * split reads as item breaks. */
  $("#add-text").addEventListener("paste", ev => {
    const t = (ev.clipboardData && ev.clipboardData.getData("text")) || "";
    if (!/[\r\n]/.test(t)) return;
    ev.preventDefault();
    const f = $("#add-text");
    const clean = t.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean).join("; ");
    f.setRangeText(clean, f.selectionStart, f.selectionEnd, "end");
    f.dispatchEvent(new Event("input"));
  });
  /* One line + Enter adds at once (the old quick-add's speed);
   * Enter inside a multi-line paste just adds a line. */
  $("#add-text").addEventListener("keydown", ev => {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    ev.preventDefault(); $("#add-submit").click();
  });

  /* The mic talks to Arya (owner, 2026-10-29): what you say is read as
   * a person would hear it, so a list is added (with Undo) and a
   * question is answered. If Arya cannot answer, the words land in the
   * field so nothing said is lost. */
  wireRecordButton($("#add-mic"), $("#add-status"), async text => {
    const here = lensList();
    const ok = await AryaAsk.run(text, { box: $("#list-answer"), surface: "list",
      context: here ? { list: here.name, list_id: here.id } : {},
      onChange: () => { renderList().catch(() => {}); } });
    if (!ok) {
      const field = $("#add-text");
      field.value = field.value.trim() ? `${field.value.trim()}, ${text}` : text;
      field.dispatchEvent(new Event("input"));
    }
  });

  let receiptFile = null;
  $("#add-photo").addEventListener("change", async ev => {
    const f = ev.target.files[0];
    if (!f) return;
    const status = $("#add-status");
    const offer = $("#add-receipt-offer");
    offer.innerHTML = "";
    status.textContent = "Reading the photo with Spark…";
    try {
      const r = await fetch("/api/list/from-photo", {
        method: "POST",
        headers: { "Content-Type": f.type || "image/jpeg" },
        body: f
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const out = await r.json();
      status.textContent = "";
      if (out.kind === "receipt") {
        receiptFile = f;
        offer.innerHTML = `<p class="nomargin" style="margin-top:10px">This looks like a receipt.</p>
          <p style="margin-bottom:0"><button class="btn primary" id="add-file-receipt" type="button">File it as a receipt</button></p>`;
        $("#add-file-receipt").addEventListener("click", async () => {
          offer.innerHTML = "";
          await fileReceiptPhoto(receiptFile, status, null);
          receiptFile = null;
        });
      } else {
        toast(out.added === 1 ? "Added 1 item to your list."
          : `Added ${out.added} items to your list.`);
        renderList().catch(() => {});
      }
    } catch (e) {
      status.textContent = "";
      toast("Could not read that photo: " + e.message);
    }
    ev.target.value = "";
  });

  const rcPhoto = $("#rc-photo");
  if (rcPhoto) rcPhoto.addEventListener("change", async ev => {
    const f = ev.target.files[0];
    if (!f) return;
    await fileReceiptPhoto(f, $("#rc-photo-status"), $("#rc-photo-preview"));
    ev.target.value = "";
  });
}
bindAdd();

async function renderCurator() {
  const el = $("#curator");
  if (!el) return;
  const d = await api("/api/curator").catch(() => ({ proposals: [] }));
  let html = d.proposals.map(p => `
    <div class="row"><div class="grow"><span class="name">${p.kind === "merge" ? `Merge into &ldquo;${esc(p.into_name)}&rdquo;` : `Keep &ldquo;${esc(p.names[0])}&rdquo; separate`}</span>
    <span class="sub">${p.names.map(esc).join(" + ")} — ${esc(p.reason)}</span></div></div>
    <div class="actions">
      <button class="chip" data-curator-apply="${esc(p.id)}">Apply</button>
      <button class="chip" data-curator-dismiss="${esc(p.id)}">Dismiss</button>
    </div>`).join("");
  html += `<div class="row"><span class="sub grow">The Curator reasons about which products are the same item. Nothing changes until you apply it.</span>${isDemo ? "" : `<button class="btn" id="btn-curator-run">Ask the Curator</button>`}</div>`;
  el.innerHTML = html;
}

$("#curator").addEventListener("click", async ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.id === "btn-curator-run") {
      b.disabled = true;
      const r = await post("/api/curator/run");
      toast(r.proposals ? `The Curator proposed ${r.proposals} change(s).` : "The Curator found nothing to change.");
      renderCurator();
    } else if (b.dataset.curatorApply) {
      await post("/api/curator/decide", { id: b.dataset.curatorApply, action: "apply" });
      toast("Applied. The products are one now.");
      renderCurator();
    } else if (b.dataset.curatorDismiss) {
      await post("/api/curator/decide", { id: b.dataset.curatorDismiss, action: "dismiss" });
      renderCurator();
    }
  } catch (e) { toast(e.message); }
});

/* ---------------- Scan + review ---------------- */

async function renderScan() {
  const q = await api("/api/review");
  let html = "";
  for (const l of q.lines) {
    const key = `${l.receipt_id}:${l.idx}`;
    html += `<div class="row"><div class="grow"><span class="name">${esc(l.decoded_name || l.raw)}</span>
      <span class="sub">Unverified · ${fmtDate(l.date)} · from “${esc(l.raw)}”</span></div></div>
      <div class="actions">
        <button class="chip" data-confirm="${esc(key)}">Looks right</button>
        ${l.suggested ? `<button class="chip" data-alt="${esc(key)}" data-name="${esc(l.suggested.name)}">Researched: ${esc(l.suggested.name)}</button>${l.suggested.source ? `<a class="sub" href="${esc(l.suggested.source)}" target="_blank" rel="noopener">source</a>` : ""}` : ""}
        ${(l.alternatives || []).map(a => `<button class="chip" data-alt="${esc(key)}" data-name="${esc(a)}">It is ${esc(a)}</button>`).join("")}
        <button class="chip" data-fix="${esc(key)}">Fix the name</button>
      </div>
      <div class="editor" data-editor="${esc(key)}" hidden>
        <input type="text" placeholder="Correct name" aria-label="Correct name">
        <button class="chip" data-save-line="${esc(key)}">Save</button>
      </div>`;
  }
  for (const u of q.unresolved) {
    const key = `u:${u.item_id}`;
    html += `<div class="row"><div class="grow"><span class="name">${esc(u.name)}</span>
      <span class="sub">Name not settled — kept off your list until you settle it</span></div></div>
      <div class="actions">
        ${(u.candidates || []).map(cn => `<button class="chip" data-resolve="${esc(u.item_id)}" data-name="${esc(cn)}">It is ${esc(cn)}</button>`).join("")}
        <button class="chip" data-fix="${esc(key)}">Set the name</button>
      </div>
      ${(u.sources && Object.keys(u.sources).length) ? `<div class="row"><span class="sub">Researched: ${Object.entries(u.sources).map(([n, u2]) => `<a href="${esc(u2)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}</span></div>` : ""}
      <div class="editor" data-editor="${esc(key)}" hidden>
        <input type="text" placeholder="Correct name" aria-label="Correct name">
        <button class="chip" data-save-resolve="${esc(u.item_id)}">Save</button>
      </div>`;
  }
  $("#review").innerHTML = html || empty("Nothing to review. Every line is verified.");
}

$("#review").addEventListener("click", async ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.confirm) {
      const [receipt_id, idx] = b.dataset.confirm.split(":");
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "confirm" });
      toast("Confirmed. It leaves the queue.");
      renderScan();
    } else if (b.dataset.alt) {
      const [receipt_id, idx] = b.dataset.alt.split(":");
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "rename", name: b.dataset.name });
      toast(`Set to ${b.dataset.name}. The dictionary learned it.`);
      renderScan();
    } else if (b.dataset.resolve) {
      await post("/api/review/resolve", { item_id: b.dataset.resolve, name: b.dataset.name });
      toast(`Settled as ${b.dataset.name}.`);
      renderScan();
    } else if (b.dataset.fix) {
      const ed = document.querySelector(`[data-editor="${CSS.escape(b.dataset.fix)}"]`);
      if (ed) { ed.hidden = !ed.hidden; const inp = ed.querySelector("input"); if (inp && !ed.hidden) inp.focus(); }
    } else if (b.dataset.saveLine) {
      const [receipt_id, idx] = b.dataset.saveLine.split(":");
      const ed = document.querySelector(`[data-editor="${CSS.escape(b.dataset.saveLine)}"]`);
      const name = ed.querySelector("input").value.trim();
      if (!name) { toast("Type the correct name first."); return; }
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "rename", name });
      toast(`Set to ${name}. The dictionary learned it.`);
      renderScan();
    } else if (b.dataset.saveResolve) {
      const ed = document.querySelector(`[data-editor="u:${CSS.escape(b.dataset.saveResolve)}"]`);
      const name = ed.querySelector("input").value.trim();
      if (!name) { toast("Type the correct name first."); return; }
      await post("/api/review/resolve", { item_id: b.dataset.saveResolve, name });
      toast(`Settled as ${name}.`);
      renderScan();
    }
  } catch (e) { toast(e.message); }
});

/* ---------------- Eyes ---------------- */

async function renderEyes() {
  const data = await api("/api/eyes").catch(() => ({ records: [] }));
  const box = $("#eyes-records");
  if (!box) return;
  // On the List page the section exists only while a sighting waits
  // for a decision (owner wireframe, 2026-10-28) — no pending
  // sightings, no section; decided sightings report in list notes.
  const wrap = $("#list-eyes");
  const pending = data.records.some(r => (r.sightings || []).some(s => s.state === "pending"));
  if (wrap) wrap.hidden = !pending;
  if (!data.records.length) { box.innerHTML = ""; return; }
  box.innerHTML = data.records.map(rec => `
    <div class="eyes-record">
      <img src="/eyes/photos/${rec.id}" alt="Eyes photo">
      <p class="muted">${esc(rec.kind)} · ${fmtDate(rec.date)}</p>
      ${rec.sightings.map((sg, i) => `
        <div class="row"><div class="grow"><span class="name">${esc(sg.name)}</span>
        <span class="sub">${sg.judge_agree ? "" : "two reads disagreed · "}${esc(sg.state)}</span></div>
        ${sg.state === "pending" ? `<div>
          <button class="chip eyes-confirm" data-rec="${rec.id}" data-idx="${i}">Yes, it&rsquo;s there</button>
          <button class="chip eyes-reject" data-rec="${rec.id}" data-idx="${i}">Not there</button></div>` : ""}
        </div>`).join("")}
      <p class="nomargin" style="margin-top:6px"><button class="chip eyes-del" data-rec="${rec.id}" type="button">Delete photo</button></p>
    </div>`).join("");
  box.querySelectorAll(".eyes-del").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this photo and its sightings? This cannot be undone.")) return;
      try {
        await post(`/api/eyes/${b.dataset.rec}/delete`, {});
        toast("Photo deleted.");
        renderEyes();
      } catch (e) { toast(e.message); }
    }));
  box.querySelectorAll(".eyes-confirm, .eyes-reject").forEach(b =>
    b.addEventListener("click", async () => {
      const decision = b.classList.contains("eyes-confirm") ? "confirmed" : "rejected";
      try {
        await post(`/api/eyes/${b.dataset.rec}/sightings/${b.dataset.idx}`, { state: decision });
        renderEyes();
      } catch (e) { toast(e.message); }
    }));
}

/* ---------------- Receipts (B4) ----------------
 * Needs-your-eye cards on top (the review queue + the Curator,
 * whose renderers and handlers are unchanged — only their home
 * moved), then the archive. Rows open the receipt detail. No spend
 * content lives here; spend is Analysis, reached from Profile. */

async function renderReceipts() {
  await Promise.all([renderScan().catch(() => {}), renderCurator().catch(() => {})]);
  const archive = await api("/api/quest/receipts").catch(() => ({ receipts: [] }));
  $("#rc-count").textContent = archive.receipts.length
    ? `${archive.receipts.length} receipts · every one digitized, total-checked, returns netted` : "";
  // Unsettled hunts (Discussion 41): a hunt finished without its
  // receipt is logged here as its own entry, tagged "Receipt
  // missing", until this trip's receipt is uploaded against it.
  const unsettled = (archive.unsettled || []).map(e => `
    <div class="sessrow">
      <span class="grow"><span class="name">${esc(e.store)}</span>
      <span class="sub">${fmtShort(String(e.finished_at || "").slice(0, 10))} · ${e.items_collected} of ${e.items_total} items collected</span></span>
      <span class="misstag">Receipt missing</span>
      <button class="btn" data-upload="${esc(e.session_id)}" data-store="${esc(e.store)}" type="button">Add receipt</button>
      <button class="btn" data-dismiss="${esc(e.session_id)}" type="button">Dismiss</button>
    </div>`).join("");
  const rows = archive.receipts.map(r => `
    <button class="sessrow" data-receipt="${esc(r.receipt_id)}" type="button">
      <span class="grow"><span class="name">${esc(r.merchant)}</span>
      <span class="sub">${fmtShort(String(r.purchased_at).slice(0, 10))} · ${r.items ? `${r.items} item${r.items === 1 ? "" : "s"}` : "no lines read"}${r.returns_total ? ` · returns −${money(r.returns_total)}` : ""}</span></span>
      <span class="money">${r.totals_reconcile ? "✓ " : ""}${r.total != null ? money(r.total) : ""}</span>
    </button>`).join("");
  $("#rc-archive").innerHTML = (unsettled || rows)
    ? unsettled + rows : empty("No receipts filed yet.");
}

/* Finished hunts still missing their receipt, each with its own
 * Add receipt (the sheet in quest.js — it attaches this trip's
 * receipt and never reopens the hunt). Used by Profile. */
function paintMissingReceipts(el, unsettled, after) {
  if (!el) return;
  el.hidden = !unsettled.length;
  el.innerHTML = unsettled.length
    ? unsettled.map(e => `<div class="sessrow">
        <span class="grow"><span class="name">${esc(e.store)}</span>
        <span class="sub">${fmtShort(String(e.finished_at || "").slice(0, 10))} · Finished · Receipt missing · ${e.items_collected} of ${e.items_total} collected</span></span>
        <button class="btn" data-upload="${esc(e.session_id)}" data-store="${esc(e.store)}" type="button">Add receipt</button>
        <button class="btn" data-dismiss="${esc(e.session_id)}" type="button">Dismiss</button>
      </div>`).join("")
    : "";
  el.onclick = async ev => {
    const dis = ev.target.closest("[data-dismiss]");
    if (dis) {
      if (!confirm("Dismiss this hunt? It leaves your Receipts list. This cannot be undone.")) return;
      try {
        await post(`/api/quest/sessions/${encodeURIComponent(dis.dataset.dismiss)}/delete`, {});
        toast("Hunt dismissed.");
        if (after) after();
      } catch (e) { toast(e.message); }
      return;
    }
    const up = ev.target.closest("[data-upload]");
    if (up && window.openAddReceipt) openAddReceipt(up.dataset.upload, up.dataset.store, after);
  };
}
$("#rc-archive").addEventListener("click", async ev => {
  const dis = ev.target.closest("[data-dismiss]");
  if (dis) {
    if (!confirm("Dismiss this hunt? It leaves your Receipts list. This cannot be undone.")) return;
    try {
      await post(`/api/quest/sessions/${encodeURIComponent(dis.dataset.dismiss)}/delete`, {});
      toast("Hunt dismissed.");
      renderReceipts().catch(showErr);
    } catch (e) { toast(e.message); }
    return;
  }
  const up = ev.target.closest("[data-upload]");
  if (up) {
    if (window.openAddReceipt)
      openAddReceipt(up.dataset.upload, up.dataset.store, () => renderReceipts().catch(showErr));
    return;
  }
  const b = ev.target.closest("[data-receipt]");
  if (b && window.openReceipt) openReceipt(b.dataset.receipt).catch(showErr);
});

/* ---------------- Analysis (B5) ----------------
 * Spend is live because it is arithmetic over verified receipts —
 * no estimates. The dashboard API reports returns as one all-time
 * total and per-month spend gross of returns, so the panel labels
 * each figure with the period it actually covers; Patterns and
 * Trends are named "Coming next" panels, never faked. */

async function renderAnalysis() {
  const d = await api("/api/dashboard");
  const monthKeys = Object.keys(d.spend_by_month).sort();
  const monthName = k => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  const latest = monthKeys[monthKeys.length - 1];
  const archive = await api("/api/quest/receipts").catch(() => ({ receipts: [] }));
  const monthReceipts = latest
    ? archive.receipts.filter(r => String(r.purchased_at).startsWith(latest)).length : 0;
  $("#an-spend").innerHTML = latest ? `
    <p class="an-cap">${esc(monthName(latest))} total</p>
    <p class="bignum">${money(d.spend_by_month[latest])}</p>
    <p class="muted" style="text-align:center">Across ${monthReceipts} receipt${monthReceipts === 1 ? "" : "s"} filed this month</p>
    ${row("Returns netted, all time", "All receipts — refunds reconcile into the ledger; returned items never count in patterns", "−" + money(d.returns_total))}
    ${row("All-time spend", `${d.trip_count} trips`, money(d.spend_total))}
    ${d.spend_other ? row("Groceries", "food and household", money(d.spend_groceries)) : ""}
    ${d.spend_other ? row("Other purchases", Object.entries(d.other_by_kind || {}).map(([k, v]) => `${esc(k)} ${money(v)}`).join(" · "), money(d.spend_other)) : ""}
    ${d.for_others_total ? row("Bought for others", "gifts and items for people outside the household", money(d.for_others_total)) : ""}`
    : empty("No trips yet.");
  // Months with no receipts still get a row, so the bars do not jump a gap.
  const spent = d.spend_by_month;
  const months = [];
  const keys = Object.keys(spent).sort();
  if (keys.length) {
    let [y, m] = keys[0].split("-").map(Number);
    const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      months.push([k, spent[k] || 0]);
      if (++m > 12) { m = 1; y++; }
    }
  }
  const max = Math.max(...months.map(([, v]) => v), 1);
  $("#an-months").innerHTML = months.map(([m, v]) =>
    `<div class="month-row"><span>${esc(monthName(m))}</span><div class="track"><div class="bar" style="width:${Math.round(v / max * 100)}%"></div></div><span class="money">${money(v)}</span></div>`).join("") || empty("No trips yet.");
  $("#an-stores").innerHTML = Object.entries(d.spend_by_store)
    .sort((a, b) => b[1] - a[1]).map(([s, v]) => row(esc(s), "", money(v))).join("") || empty("No trips yet.");
  $("#an-top").innerHTML = d.top_items.map(i =>
    `<div class="row"><div class="grow"><a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a></div><div class="money">${money(i.spend)}</div></div>`).join("") || empty("No items yet.");
  bindItemLinks($("#an-top"));
}

/* ---------------- Item page ---------------- */

async function renderItem(id) {
  show("view-item");
  const d = await api(`/api/items/${encodeURIComponent(id)}`);
  const e = d.entry, p = d.pattern;
  let html = `<h2 class="largetitle" style="font-size:28px">${esc(e ? e.canonical_name : id)}</h2>`;
  if (p && p.history_state !== "not-enough-history") {
    html += `<div class="group">${row("Buys", "", String(p.purchase_count))}${row("Rhythm", "", `every ~${Math.round(p.median_interval_days)} days`)}${row("Last bought", "", fmtDate(p.last_bought))}${row("Total spend", "", money(p.total_spend))}</div>`;
  } else {
    html += `<p class="muted">Not enough history yet for a pattern.</p>`;
  }
  if (p && p.judge) {
    const onList = p.admitted;
    html += `<h3 class="sect">Why Arya ${onList ? "suggests it" : "leaves it off"}</h3><div class="group">` +
      row(esc(p.judge.class.replace("_", " ")), esc(p.judge.reason), onList ? "On the list" : "Off the list") + `</div>`;
  }
  if (p && p.analysis && p.analysis.verdict) {
    html += `<p class="muted">Pattern check: ${esc(p.analysis.verdict)}${p.analysis.seasonal_months ? ` · bought mostly in ${p.analysis.seasonal_months.map(m => MONTHS[m - 1]).join(", ")}` : ""}.</p>`;
  }
  const stores = Object.entries(d.price_by_store);
  if (stores.length) {
    html += `<h3 class="sect">Price by store</h3><div class="group">` + stores.map(([s, v]) =>
      row(esc(s), `${v.count} buys`, v.min === v.max ? money(v.min) : `${money(v.min)} – ${money(v.max)}`)).join("") + `</div>`;
  }
  if (d.history.length) {
    html += `<h3 class="sect">Recent history</h3><div class="group">` + d.history.slice(0, 10).map(h =>
      row(fmtDate(h.date), h.event_type === "return" ? "Returned" : esc(h.store_id || ""),
          `<span class="${h.event_type === "return" ? "return" : ""}">${h.event_type === "return" ? "−" : ""}${money(h.price)}</span>`)).join("") + `</div>`;
  }
  html += `<p style="margin-top:20px; display:flex; gap:8px; flex-wrap:wrap">
    <button class="btn secondary" id="btn-add">Add to list</button>
    <button class="btn secondary" id="btn-never">Never suggest</button>
    <button class="btn secondary" id="btn-expired">This expired</button></p>
    <p id="flag-result" class="muted"></p>`;
  $("#item-detail").innerHTML = html;
  $("#btn-add").addEventListener("click", async () => {
    try { await post("/api/list/add", { item_id: id }); $("#flag-result").textContent = "Added to your list."; }
    catch (e) { toast(e.message); }
  });
  $("#btn-never").addEventListener("click", async () => {
    try { await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: true }); $("#flag-result").textContent = "Arya will not suggest this again."; }
    catch (e) { toast(e.message); }
  });
  $("#btn-expired").addEventListener("click", async () => {
    try { await post(`/api/items/${encodeURIComponent(id)}/expired`); $("#flag-result").textContent = "Marked expired. It's on your list."; }
    catch (e) { toast(e.message); }
  });
}

/* ---------------- Navigation ---------------- */

function show(id) {
  /* Every tab opens at its top, not wherever the last one was left
   * (QA 2026-10-28). */
  const shown = document.querySelector(".view:not([hidden])");
  if (!shown || shown.id !== id) window.scrollTo(0, 0);
  document.querySelectorAll(".view").forEach(v => {
    v.hidden = v.id !== id;
    if (v.id === id) { v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); }
  });
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  if (id !== "view-item") lastView = id;
}
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => { show(b.dataset.view); refresh(b.dataset.view); }));
$("#item-back").addEventListener("click", ev => { ev.preventDefault(); show(lastView); refresh(lastView); });

function refresh(view) {
  if (view === "view-home") renderHome().catch(showErr);
  if (view === "view-list") { renderList().catch(showErr); renderIntake().catch(showErr); renderEyes().catch(showErr); }
  if (view === "view-receipts") renderReceipts().catch(showErr);
  if (view === "view-analysis") renderAnalysis().catch(showErr);
  if (view === "view-profile" || view === "view-quest-progress" || view === "view-muse") renderProfile().catch(showErr);
  if (view === "view-community") { renderQuestHub().catch(showErr); renderCommunity().catch(showErr); }
  if (view === "view-chat") paintChatEmpty();
}

/* ---------------- Ask Arya + voice ---------------- */

const chatHistory = [];
/* A first-run Ask screen must not be an empty box with a bare
 * input (review 2026-10-28, U2): an empty log paints a prompt
 * line and three tappable questions. The block removes itself
 * the moment the conversation starts. */
function paintChatEmpty() {
  const log = $("#chat-log");
  if (!log || log.children.length) return;
  const el = document.createElement("div");
  el.id = "chat-empty";
  el.innerHTML = `<p class="muted">Ask about your list, your spending, or what is running low.</p>` +
    ["What's running low?", "What did I spend this month?", "Add eggs to my list"]
      .map(q => `<button class="chip" type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
  log.appendChild(el);
  el.querySelectorAll("[data-ask]").forEach(b =>
    b.addEventListener("click", () => {
      $("#chat-input").value = b.dataset.ask;
      $("#chat-form").requestSubmit();
    }));
}

function chatLine(kind, text) {
  const stale = $("#chat-empty");
  if (stale) stale.remove();
  const el = document.createElement("div");
  el.className = "bubble " + kind;
  el.textContent = text;
  $("#chat-log").appendChild(el);
  el.scrollIntoView({ block: "end" });
}
/* B3: a confirmed action renders as a chip under the reply — the
 * wireframe's "✓ Yogurt marked finished" — not as a log line. */
function chatChip(text) {
  const el = document.createElement("div");
  el.className = "bubble actionchip";
  el.textContent = "✓ " + text;
  $("#chat-log").appendChild(el);
  el.scrollIntoView({ block: "end" });
}
let speakOn = localStorage.getItem("arya-speak") === "1";
function paintSpeak() {
  $("#btn-speak").classList.toggle("on", speakOn);
  $("#btn-speak").setAttribute("aria-pressed", String(speakOn));
}
$("#btn-speak").addEventListener("click", () => {
  speakOn = !speakOn;
  localStorage.setItem("arya-speak", speakOn ? "1" : "0");
  paintSpeak();
  if (!speakOn && "speechSynthesis" in window) speechSynthesis.cancel();
});
function speak(text) {
  if (!speakOn || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
/* Ask voice input is Muse Voice Transcribe on the Meta API (the
 * shared recorder above) — not the browser's speech engine. Speech
 * output stays device TTS: Meta has no TTS API, and nothing labels
 * it otherwise. */
let askCapture = null;
$("#btn-mic").addEventListener("click", async () => {
  const note = $("#voice-note");
  const btn = $("#btn-mic");
  if (askCapture) {
    const wav = askCapture.stop();
    askCapture = null;
    btn.classList.remove("listening");
    note.hidden = false;
    note.textContent = "Transcribing with Muse Voice Transcribe…";
    try {
      const text = await transcribeBlob(wav);
      if (text) {
        note.hidden = true;
        $("#chat-input").value = text;
        $("#chat-form").requestSubmit();
      } else {
        note.textContent = "That did not come through. Try again, or type it.";
      }
    } catch (e) {
      note.textContent = "Transcription failed: " + e.message;
    }
    return;
  }
  if (!navigator.mediaDevices || !(window.AudioContext || window.webkitAudioContext)) {
    note.hidden = false;
    note.textContent = "Voice input is not available in this browser. The microphone on your keyboard works too.";
    return;
  }
  try {
    askCapture = await startCapture();
    btn.classList.add("listening");
    note.hidden = false;
    note.textContent = "Listening… tap the mic again to send.";
  } catch (e) {
    note.hidden = false;
    note.textContent = "Microphone access was refused. You can type instead.";
  }
});
$("#chat-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) { toast("Type a question first."); input.focus(); return; }
  input.value = "";
  chatHistory.push({ role: "user", content: text });
  chatLine("me", text);
  try {
    const res = await post("/api/chat", { messages: chatHistory });
    chatHistory.push({ role: "assistant", content: res.reply });
    chatLine("arya", res.reply);
    speak(res.reply);
    (res.applied || []).forEach(a => chatChip(a));
    (res.skipped || []).forEach(a => chatLine("sys", a));
  } catch (e) {
    chatLine("arya", "I could not answer that: " + e.message);
  }
});

/* ---------------- Boot ---------------- */

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
paintSpeak();

async function boot() {
  const status = await api("/auth/status").catch(() => ({ has_users: true, registration_open: false }));
  const me = await fetch("/auth/me").then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (me && me.user) {
    enterApp(me.user, me.demo);
    return;
  }
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-login"; });
  // Three modes: bootstrap (no accounts yet -> setup), sign in, and
  // public registration. Registration is LOCKED by default (owner,
  // 2026-10-28): the toggle shows only when the server reports it
  // open (ARYA_REGISTRATION_OPEN=1). Bootstrap never shows it.
  let loginMode = status.has_users ? "login" : "setup";
  const paintLoginMode = () => {
    const create = loginMode !== "login";
    $("#login-title").textContent = create ? "Create your account" : "Sign in";
    $("#login-user").parentElement.firstChild.textContent = create ? "Username" : "Email or username";
    $("#login-btn").textContent = create ? "Create account" : "Sign in";
    $("#login-pass").autocomplete = create ? "new-password" : "current-password";
    $("#login-toggle").hidden = loginMode === "setup" || !status.registration_open;
    $("#login-toggle").textContent = create ? "Already have an account? Sign in" : "New here? Create account";
    $("#login-error").textContent = "";
  };
  const sheet = (id, on) => { $(id).hidden = !on; };
  $("#signin-open").addEventListener("click", () => { sheet("#signin-sheet", true); $("#login-user").focus(); });
  $("#signin-close").addEventListener("click", () => sheet("#signin-sheet", false));
  $("#how-open").addEventListener("click", () => sheet("#how-sheet", true));
  $("#how-close").addEventListener("click", () => sheet("#how-sheet", false));
  if (!status.has_users) sheet("#signin-sheet", true);
  paintLoginMode();
  $("#login-toggle").addEventListener("click", () => {
    if (!status.registration_open) return;
    loginMode = loginMode === "login" ? "register" : "login";
    paintLoginMode();
  });
  $("#login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const body = JSON.stringify({ username: $("#login-user").value.trim(), password: $("#login-pass").value });
    const path = loginMode === "login" ? "/auth/login" : loginMode === "register" ? "/auth/register" : "/auth/setup";
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) {
      $("#login-error").textContent = (await r.json().catch(() => ({}))).detail || (loginMode === "login" ? "Sign-in failed." : "Could not create the account.");
      return;
    }
    const data = await r.json();
    enterApp(data.user, false);
  });
  if (status.email_signin) {
    $("#email-signin").hidden = false;
    let sent = false;
    $("#code-form").addEventListener("submit", async ev => {
      ev.preventDefault();
      const email = $("#code-email").value.trim();
      const post = (path, b) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      const r = sent ? await post("/auth/email/verify", { email, code: $("#code-input").value }) : await post("/auth/email/start", { email });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { $("#code-msg").textContent = data.detail || "Something went wrong."; return; }
      if (sent) { enterApp(data.user, false); return; }
      sent = true;
      $("#code-field").hidden = false;
      $("#code-btn").textContent = "Sign in";
      $("#code-msg").textContent = "We emailed you a code. Enter it here.";
      $("#code-input").focus();
    });
    if (location.search.includes("signin=failed")) { sheet("#signin-sheet", true); $("#code-msg").textContent = "Google sign-in did not finish. Try again."; }
  }
  $("#demo-btn").addEventListener("click", async () => {
    const r = await fetch("/auth/demo", { method: "POST" });
    if (r.ok) { enterApp("demo", true); return; }
    $("#login-error").textContent = (await r.json().catch(() => ({}))).detail || "The demo did not open. Try again.";
    sheet("#signin-sheet", true);
  });
}

function enterApp(user, demo) {
  isDemo = demo;
  window.__aryaUser = user;
  $("#view-login").hidden = true;
  $("#avatar-initial").textContent = (demo ? "demo" : String(user || "A")).charAt(0).toUpperCase();
  $("#demobar").hidden = !demo;
  // Every account opens on Today; Muse is linked from Profile.
  if (demo) $("#chat-demo-note").hidden = false;
  openShell();
}

function openShell() {
  $("#app-main").hidden = false;
  $("#tabs").hidden = false;
  $("#avatar-btn").hidden = false;
  loadAvatar();
  loadCurrency();
  show("view-home");
  refresh("view-home");
}
/* ---------------- Avatar ----------------
 * One avatar for the whole app: a cast character, a Muse Image
 * drawing from a description, or a drawing made from the player's
 * own photo (the photo is dropped server-side). The same avatar
 * hosts the haul cards and the love note. A made picture waits as
 * a candidate until Use this. */
let AV = { file: null, image: false, version: 0 };
function avatarSrc() {
  return AV.image ? `/api/quest/avatar/image?v=${AV.version}` : `assets/characters/${AV.file || "basket.webp"}`;
}
function paintAvatar() {
  for (const id of ["avatar", "pf-avatar"]) {
    const img = $(`#${id}-img`);
    if (!img) continue;
    img.hidden = false;
    img.src = avatarSrc();
  }
  document.querySelectorAll("#av-presets button").forEach(b =>
    b.setAttribute("aria-pressed", String(!AV.image && b.dataset.file === (AV.file || "basket.webp"))));
}
async function castFiles() {
  if (!CHARM) {
    try { CHARM = await (await fetch("assets/characters/manifest.json")).json(); }
    catch (e) { return []; }
  }
  return [...new Set([...(CHARM.items || []).map(i => i.char),
    ...(CHARM.categories || []).map(c => c.char),
    ...Object.values(CHARM.roles || {}), CHARM.fallback].filter(Boolean))];
}
async function loadAvatar() {
  try { AV = await api("/api/quest/avatar"); } catch (e) { return; }
  try { localStorage.setItem("arya-avatar", AV.file || "basket.webp"); } catch (e) {}
  const box = $("#av-presets");
  if (box && !box.children.length) {
    box.innerHTML = (await castFiles()).map(f =>
      `<button type="button" data-file="${esc(f)}" aria-label="${esc(f.replace(".webp", ""))}" aria-pressed="false"><img src="assets/characters/${esc(f)}" alt=""></button>`).join("");
  }
  $("#av-make-box").hidden = isDemo;
  $("#pf-avatar-initial").textContent = ($("#avatar-initial").textContent || "A");
  paintAvatar();
}
/* The avatar choices stay shut until the player taps Edit. */
function avEdit(open) {
  $("#av-panel").hidden = !open;
  $("#av-edit-btn").setAttribute("aria-expanded", String(open));
  $("#av-edit-label").textContent = open ? "Done" : "Edit avatar";
}
$("#av-edit-btn").addEventListener("click", () => avEdit($("#av-panel").hidden));
$("#av-edit-label").addEventListener("click", () => avEdit($("#av-panel").hidden));
function avStatus(msg) { $("#av-status").textContent = msg || ""; }
function avShowCandidate() {
  $("#av-cand-img").src = `/api/quest/avatar/image?candidate=true&t=${Date.now()}`;
  $("#av-candidate").hidden = false;
}
$("#av-presets").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-file]");
  if (!b) return;
  try {
    await post("/api/quest/avatar", { file: b.dataset.file });
    AV = { ...AV, file: b.dataset.file, image: false };
    try { localStorage.setItem("arya-avatar", b.dataset.file); } catch (e) {}
    paintAvatar(); avStatus("");
  } catch (e) { toast(e.message); }
});
$("#av-make").addEventListener("click", async () => {
  const prompt = $("#av-prompt").value.trim();
  if (!prompt) { toast("Describe your avatar first."); return; }
  const btn = $("#av-make"); btn.disabled = true; avStatus("Drawing it…");
  try { await post("/api/quest/avatar/generate", { prompt }); avStatus(""); avShowCandidate(); }
  catch (e) { avStatus(e.message); }
  btn.disabled = false;
});
$("#av-photo").addEventListener("change", async ev => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  avStatus("Drawing you as a cartoon…");
  try {
    const r = await fetch("/api/quest/avatar/photo", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Could not make it");
    avStatus(""); avShowCandidate();
  } catch (e) { avStatus(e.message); }
});
$("#av-use").addEventListener("click", async () => {
  try { AV = { ...AV, ...(await post("/api/quest/avatar/use", {})) }; $("#av-candidate").hidden = true; paintAvatar(); toast("Avatar saved."); }
  catch (e) { toast(e.message); }
});

/* The avatar (top right) is the way to Profile: Profile is not a
 * tab. Back returns to the tab the player left. */
let avatarFrom = "view-home";
$("#avatar-btn").addEventListener("click", () => {
  const cur = [...document.querySelectorAll(".view")].find(v => !v.hidden);
  avatarFrom = cur && document.querySelector(`#tabs button[data-view="${cur.id}"]`) ? cur.id : "view-home";
  show("view-profile");
  refresh("view-profile");
  avEdit(false);
  loadAvatar();
  window.scrollTo(0, 0);
});
$("#pf-back").addEventListener("click", ev => {
  ev.preventDefault();
  show(avatarFrom);
  refresh(avatarFrom);
});
boot();
