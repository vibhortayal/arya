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
  return `${MONTHS[m - 1]} ${d}`;
}
function money(n) {
  return "$" + Math.abs(n).toFixed(2);
}
function qtyFmt(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
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

function listRow(i, tags) {
  const reason = [i.due_reason, i.judge_reason].filter(Boolean).join(" · ");
  const tagHtml = (tags || []).map(t => `<span class="storetag">${esc(t)}</span>`).join("");
  return `<div class="row listrow${i.checked ? " checked" : ""}">
    <button class="check" data-act="check" data-id="${esc(i.item_id)}" aria-label="Check off ${esc(i.name)}">${CHECK_SVG}</button>
    <div class="grow"><a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a>${tagHtml}
    ${reason ? `<span class="sub">${esc(reason)}</span>` : ""}</div>
    <div class="stepper">
      <button data-act="dec" data-id="${esc(i.item_id)}" aria-label="One less">−</button>
      <span class="qty">× ${qtyFmt(i.qty)}</span>
      <button data-act="inc" data-id="${esc(i.item_id)}" aria-label="One more">+</button>
    </div>
    <button class="remove" data-act="remove" data-id="${esc(i.item_id)}" aria-label="Remove ${esc(i.name)} from the list">×</button>
  </div>`;
}

function bindItemLinks(root) {
  if (!root) return;
  root.querySelectorAll(".item-link").forEach(a =>
    a.addEventListener("click", ev => { ev.preventDefault(); renderItem(a.dataset.id); }));
}

/* The owner's Today/List line, in his format: a count, the names,
 * the evidence, and the returns rule — plain text, no cards. */
function staplesLine(items, verified) {
  const tail = ` — learned from ${verified} verified receipt${verified === 1 ? "" : "s"}. Returned items never re-suggested.`;
  if (!items.length) return `Nothing due${tail}`;
  return `${items.length} staple${items.length === 1 ? "" : "s"} due: ${items.map(i => i.name).join(" · ")}${tail}`;
}

async function verifiedReceipts() {
  const archive = await api("/api/quest/receipts").catch(() => ({ receipts: [] }));
  return archive.receipts.filter(r => r.totals_reconcile).length;
}

/* ---------------- Today (decluttered) ----------------
 * Greeting, ONE hero card (the resumable hunt; Resume is the only
 * primary button), compact game rows, one Needs-your-eye row, and
 * the list as one plain-text line. No money, no Community/Profile
 * cards — those live behind the Profile tab. */

const QSTATE_LBL = { not_started: "Not started", playing: "Playing", paused: "Paused", finished: "Finished — add the receipt", done: "Done" };
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

function paintTodayHero(sessions) {
  const el = $("#today-hero");
  const rank = { playing: 0, paused: 1, finished: 2, not_started: 3 };
  const hero = sessions.filter(s => s.state !== "done")
    .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9))[0];
  if (!hero) { el.innerHTML = ""; return; }
  const p = sessProgress(hero);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const kicker = hero.state === "not_started" ? "Up next — your next game" : "In progress — your next action";
  const btn = hero.state === "finished" ? "Add the receipt ▸" : hero.state === "not_started" ? "Start ▸" : "Resume ▸";
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

function paintTodayGames(sessions) {
  const el = $("#quest-sessions");
  el.innerHTML = sessions.length ? sessions.map(s => {
    const p = sessProgress(s);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const bar = (s.state === "playing" || s.state === "paused")
      ? `<span class="track g-bar"><span class="bar" style="width:${pct}%"></span></span>` : "";
    return `<button class="gamerow" data-sess="${esc(s.id)}" type="button">
      <span class="storeic">${BASKET_SVG}</span>
      <span class="g-main"><span class="g-name">${esc(s.store)} — ${QMODE_LBL[s.mode] || esc(s.mode)}</span>
      <span class="g-meta">${QSTATE_LBL[s.state] || esc(s.state)} · ${p.done} of ${p.total}</span></span>
      ${bar}<span class="chev">›</span></button>`;
  }).join("") : `<p class="empty">No hunts yet today. Start one — the list becomes the game.</p>`;
}

async function renderHome() {
  const h = await api("/api/home");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = h.as_of ? new Date(`${h.as_of}T12:00:00`) : new Date();
  $("#today-dow").textContent = `${days[d.getDay()]} · ${h.as_of ? fmtDate(h.as_of) : ""}`;
  let sessions = [];
  if (window.qLoadSessions) {
    try { sessions = await qLoadSessions(); } catch (e) { sessions = []; }
  }
  paintTodayHero(sessions);
  paintTodayGames(sessions);
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
  $("#today-listline-text").textContent = staplesLine(h.list.items, await verifiedReceipts());
}

$("#today-listline").addEventListener("click", () => { show("view-list"); refresh("view-list"); });

/* ---------------- List (B1: one list, a store lens) ----------------
 * Store affinity comes from purchase history: /api/items/{id}
 * price_by_store is the honest source (the dictionary tracks
 * store-varying prices). An item with no history at a store sits in
 * "Could grab here too" under that store's lens. Check-off is the
 * same global flag in every lens — the lens never duplicates. */

let listLens = "All";
let listData = null;
const itemStores = {};

async function loadItemStores(items) {
  await Promise.all(items.map(async i => {
    if (itemStores[i.item_id]) return;
    try {
      const d = await api(`/api/items/${encodeURIComponent(i.item_id)}`);
      itemStores[i.item_id] = Object.keys(d.price_by_store || {});
    } catch (e) { itemStores[i.item_id] = []; }
  }));
}

function paintStoreFilter(items) {
  const stores = [...new Set(items.flatMap(i => itemStores[i.item_id] || []))].sort();
  if (listLens !== "All" && !stores.includes(listLens)) listLens = "All";
  $("#store-filter").innerHTML = ["All", ...stores].map(s =>
    `<button class="chip" data-lens="${esc(s)}" aria-pressed="${String(listLens === s)}" type="button">${esc(s)}</button>`).join("");
}

$("#store-filter").addEventListener("click", ev => {
  const b = ev.target.closest("[data-lens]");
  if (!b) return;
  listLens = b.dataset.lens;
  paintStoreFilter(listData.list.items);
  paintListGroups();
});

function paintListGroups() {
  const items = listData.list.items;
  const box = $("#smart-list");
  if (!items.length) { box.innerHTML = empty("The list is empty. Nothing is due yet."); return; }
  if (listLens === "All") {
    box.innerHTML = `<div class="group">${items.map(i => listRow(i, itemStores[i.item_id] || [])).join("")}</div>`;
  } else {
    const mine = items.filter(i => (itemStores[i.item_id] || []).includes(listLens));
    const rest = items.filter(i => !(itemStores[i.item_id] || []).includes(listLens));
    box.innerHTML =
      `<p class="grouplabel">Your ${esc(listLens)} list</p>` +
      (mine.length ? `<div class="group">${mine.map(i => listRow(i, [])).join("")}</div>`
                   : empty(`Nothing on your list is usually bought at ${esc(listLens)}.`)) +
      (rest.length ? `<p class="grouplabel">Could grab here too</p><div class="grabgroup"><div class="group">${rest.map(i => listRow(i, [])).join("")}</div></div>` : "");
  }
  bindItemLinks(box);
}

/* The list-row actions (check / stepper / remove). The endpoints
 * always existed; the Stage 6 file split dropped these handlers —
 * restored here, one delegation for every lens. */
$("#smart-list").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, item = listItems[id];
  try {
    if (b.dataset.act === "check") {
      await post("/api/list/check", { item_id: id, checked: !(item && item.checked) });
    } else if (b.dataset.act === "inc" || b.dataset.act === "dec") {
      const cur = item ? Number(item.qty) || 1 : 1;
      await post("/api/list/qty", { item_id: id, qty: Math.max(1, cur + (b.dataset.act === "inc" ? 1 : -1)) });
    } else if (b.dataset.act === "remove") {
      await post("/api/list/remove", { item_id: id });
    } else return;
    renderList().catch(showErr);
  } catch (e) { toast(e.message); }
});

$("#list-add-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const input = $("#list-add-input");
  const name = input.value.trim();
  if (!name) return;
  try {
    await post("/api/list/add", { name });
    input.value = "";
    toast(`Added ${name} to your list.`);
    renderList().catch(showErr);
  } catch (e) { toast(e.message); }
});

function paintListNotes(h) {
  let notes = "";
  if (h.seen && h.seen.length) {
    notes += h.seen.map(s => `<div class="row"><div class="grow"><span class="name">${esc(s.name)}</span><span class="sub">Seen in the ${esc(s.kind)} · ${fmtShort(s.date)} — in stock, left off the list.</span></div></div>`).join("");
  }
  if (h.checks && h.checks.length) {
    notes += h.checks.map(c => `<div class="row"><div class="grow"><span style="font-size:15px">${esc(c.text)}</span></div><div>
      <button class="chip" data-check-ok="${esc(c.item_id)}">Still good</button>
      <button class="chip" data-check-expired="${esc(c.item_id)}">It expired</button></div></div>`).join("");
  }
  $("#list-notes").innerHTML = notes ? `<h3 class="sect">Worth a look</h3><div class="group">${notes}</div>` : "";
  bindItemLinks($("#list-notes"));
}

$("#list-notes").addEventListener("click", async ev => {
  const ok = ev.target.closest("[data-check-ok]");
  const ex = ev.target.closest("[data-check-expired]");
  if (!ok && !ex) return;
  try {
    if (ok) {
      await post("/api/list/check-ok", { item_id: ok.dataset.checkOk });
      toast("Still good — Arya will ask again next cycle.");
    } else {
      await post(`/api/items/${encodeURIComponent(ex.dataset.checkExpired)}/expired`);
      toast("Marked expired. It's on your list.");
    }
    renderList().catch(showErr);
  } catch (e) { toast(e.message); }
});

function paintCart(h) {
  const c = h.cart;
  $("#cart").innerHTML =
    row(`${esc(c.store)} · ${c.items.length} items`, c.state === "approved" ? "Approved" : "Waiting for your approval",
        c.state === "approved" ? "" : `<button id="btn-approve" class="btn primary">Approve</button>`) +
    c.items.map(i => `<div class="row"><div class="grow"><span>${esc(i.name)}</span></div><div class="money">× ${qtyFmt(i.qty)}</div></div>`).join("") +
    `<p class="muted">Approving does not place an order. The cart is a list you take to the store.</p>`;
  const b = $("#btn-approve");
  if (b) b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await post("/api/cart/approve");
      toast("Cart approved. Nothing was ordered — the cart is a proposal.");
      renderList().catch(showErr);
    } catch (e) { toast(e.message); b.disabled = false; }
  });
}

async function renderList() {
  const h = await api("/api/home");
  listData = h;
  listItems = Object.fromEntries(h.list.items.map(i => [i.item_id, i]));
  $("#list-line").textContent = staplesLine(h.list.items, await verifiedReceipts());
  await loadItemStores(h.list.items);
  paintStoreFilter(h.list.items);
  paintListGroups();
  paintListNotes(h);
  paintCart(h);
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
  el.innerHTML = `${has ? `<span class="sub grow">A connector token is active.</span>` : `<span class="sub grow">No token yet.</span>`}<button class="btn" data-mint="1">${has ? "Replace token" : "Create connector token"}</button>${has ? `<button class="btn danger" data-revoke="1">Revoke</button>` : ""}`;
}

async function mintInto(el) {
  try {
    const t = await post("/auth/token");
    el.innerHTML = `<input class="grow" data-token-value readonly value="${esc(t.token)}"><button class="btn" data-copy="1">Copy</button>
      <span class="sub">Copy it now — it is not shown again. Paste it into Muse's secure form.</span>`;
  } catch (e) { toast(e.message); }
}

document.addEventListener("click", async ev => {
  const rowEl = ev.target.closest("#profile-token-row, #connect-token-row");
  if (!rowEl) return;
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.mint) mintInto(rowEl);
  else if (b.dataset.copy) {
    const i = rowEl.querySelector("[data-token-value]"); i.select();
    if (navigator.clipboard) navigator.clipboard.writeText(i.value);
    toast("Token copied.");
  } else if (b.dataset.revoke) {
    try { await api("/auth/token", { method: "DELETE" }); toast("Connector token revoked."); paintTokenRow(rowEl); }
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
  $("#profile-account").innerHTML = row("Signed in as", "", esc(isDemo ? "demo" : (window.__aryaUser || "")));
  paintTokenRow($("#profile-token-row"));
  const [profile, archive] = await Promise.all([
    api("/api/quest/profile").catch(() => null),
    api("/api/quest/receipts").catch(() => ({ receipts: [] }))
  ]);
  $("#pf-receipts-sub").textContent = archive.receipts.length
    ? `${archive.receipts.length} receipts · the private archive` : "The private archive";
  if (!profile) {
    $("#pf-card").innerHTML = empty("Your player card could not load.");
    $("#pf-stats").innerHTML = "";
    $("#pf-spots").innerHTML = "";
    $("#pf-badges").innerHTML = "";
    $("#pf-stores").innerHTML = "";
    return;
  }
  const s = profile.stats;
  $("#pf-card").innerHTML = `<p class="nomargin"><strong style="font-size:19px">@${esc(profile.handle)}</strong></p>
    <p class="muted nomargin">Your public player card — boards and badges only. Lists, receipts and spend stay private.</p>`;
  $("#pf-stats").innerHTML =
    `<div class="stattile"><div class="sv">${s.hunts}</div><div class="sl">Hunts</div></div>
     <div class="stattile"><div class="sv">${s.receipts}</div><div class="sl">Receipts</div></div>
     <div class="stattile"><div class="sv">${s.streak_weeks} wk${s.streak_weeks === 1 ? "" : "s"}</div><div class="sl">Streak</div></div>`;
  const eagle = (profile.badges || []).find(b => b.id === "eagle_eye");
  $("#pf-spots").innerHTML =
    row("Spots reported", "Points land only when a spot verifies", String(s.spots_reported || 0)) +
    (eagle ? row("Eagle Eye", esc(eagle.detail || eagle.criteria), eagle.earned ? "Earned ✓" : "Locked") : "");
  $("#pf-badges").innerHTML = (profile.badges || []).map(b =>
    `<div class="badgetile${b.earned ? "" : " locked"}"><h4>${esc(b.name)}</h4><p>${esc(b.criteria)}</p>
     <span class="b-state">${b.earned ? "Earned ✓" : `Locked · ${esc(b.detail || "")}`}</span></div>`).join("");
  $("#pf-stores").innerHTML = profile.mapped_stores && profile.mapped_stores.length
    ? profile.mapped_stores.map(st => row(esc(st), "Mapped by you", "✓")).join("")
    : empty("No stores mapped yet. Mapping a store is how its 3D view gets built.");
}

$("#btn-analysis").addEventListener("click", () => { show("view-analysis"); refresh("view-analysis"); });
/* Analysis is reached only from Profile, and the wireframe's back
 * arrow returns there — not through the quest view stack. */
$("#an-back").addEventListener("click", ev => { ev.preventDefault(); show("view-profile"); refresh("view-profile"); });
$("#btn-receipts").addEventListener("click", () => { receiptsFrom = "view-profile"; show("view-receipts"); refresh("view-receipts"); });
// Receipts back returns to the Brain view that opened it,
// through that tab's own entry so tab state stays in sync.
$("#rc-back").addEventListener("click", ev => { ev.preventDefault();
  document.querySelector(`.tab[data-view="${receiptsFrom}"]`).click(); });

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
  const label = btn.textContent;
  btn.addEventListener("click", async () => {
    if (capture) {
      const wav = capture.stop();
      capture = null;
      btn.classList.remove("listening");
      btn.textContent = label;
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
      btn.textContent = "Stop & transcribe";
      statusEl.textContent = "Listening…";
    } catch (e) {
      statusEl.textContent = "Microphone access was refused. You can type instead.";
    }
  });
}

async function renderIntake() {
  const field = $("#add-text");
  if (!field) return;
  if (isDemo) {
    field.disabled = true;
    $("#add-submit").disabled = true;
    $("#add-status").textContent =
      "Demo: the camera and microphone read live; nothing is saved, and typing is off.";
    $("#add-claude-line").textContent =
      "The demo does not connect a Muse. The camera and microphone here call the Meta API live — try those.";
  }
}

/* File a receipt photo (image only): the one receipt path the
 * Receipts view and the Add camera's receipt offer share. */
async function fileReceiptPhoto(file, statusEl, previewEl) {
  statusEl.textContent = "Reading the receipt with Spark…";
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
        <p class="nomargin"><strong>${esc(rec.merchant || "Receipt")}</strong> <span class="sub">demo preview — read live, not saved</span></p>
        ${(rec.lines || []).map(l => row(esc(l.decoded_name || l.raw || "line"), "", l.line_total != null ? money(l.line_total) : "")).join("")}
        ${rec.total != null ? row("Total", "", money(rec.total)) : ""}</div>`;
      else statusEl.textContent = "Read live — demo preview, not saved.";
    } else {
      toast(`Filed ${rec.merchant || "the receipt"} — ${(rec.lines || []).length} lines. Anything unsure is in Receipts, under Needs your eye.`);
      renderScan().catch(showErr);
    }
  } catch (e) {
    statusEl.textContent = "";
    toast("Could not read that photo: " + e.message);
  }
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
      const r = await post("/api/list/from-text", { text });
      field.value = "";
      $("#add-status").textContent = "";
      toast(r.added === 1 ? "Added 1 item to your list."
        : `Added ${r.added} items to your list.`);
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  });

  wireRecordButton($("#add-mic"), $("#add-status"), text => {
    const field = $("#add-text");
    field.value = field.value.trim() ? `${field.value.trim()}, ${text}` : text;
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
      } else if (out.demo) {
        // Preview only: the items land in the field, unsaved.
        $("#add-text").value = (out.names || []).join(", ");
        status.textContent = "Read live — a preview in the field; the demo saves nothing.";
      } else {
        toast(out.added === 1 ? "Added 1 item to your list."
          : `Added ${out.added} items to your list.`);
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
    </div>`).join("");
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
  $("#rc-archive").innerHTML = archive.receipts.length ? archive.receipts.map(r => `
    <button class="sessrow" data-receipt="${esc(r.receipt_id)}" type="button">
      <span class="grow"><span class="name">${esc(r.merchant)}</span>
      <span class="sub">${fmtShort(String(r.purchased_at).slice(0, 10))} · ${r.items} items${r.returns_total ? ` · returns −${money(r.returns_total)}` : ""}</span></span>
      <span class="money">${r.totals_reconcile ? "✓ " : ""}${r.total != null ? money(r.total) : ""}</span>
    </button>`).join("") : empty("No receipts filed yet.");
}

$("#rc-archive").addEventListener("click", ev => {
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
    ${row("Returns netted", "All receipts — refunds reconcile into the ledger; returned items never count in patterns", "−" + money(d.returns_total))}
    ${row("All-time spend", `${d.trip_count} trips`, money(d.spend_total))}
    ${d.for_others_total ? row("Bought for others", "gifts and items for people outside the household", money(d.for_others_total)) : ""}`
    : empty("No trips yet.");
  const months = Object.entries(d.spend_by_month);
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
  if (view === "view-list") renderList().catch(showErr);
  if (view === "view-scan") { renderIntake().catch(showErr); renderEyes().catch(showErr); }
  if (view === "view-receipts") renderReceipts().catch(showErr);
  if (view === "view-analysis") renderAnalysis().catch(showErr);
  if (view === "view-profile") renderProfile().catch(showErr);
}

/* ---------------- Ask Arya + voice ---------------- */

const chatHistory = [];
function chatLine(kind, text) {
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
  if (!text) return;
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
  const status = await api("/auth/status").catch(() => ({ has_users: true }));
  const me = await fetch("/auth/me").then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (me) {
    enterApp(me.user, me.demo);
    return;
  }
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-login"; });
  $("#login-title").textContent = status.has_users ? "Sign in" : "Create your account";
  $("#login-btn").textContent = status.has_users ? "Sign in" : "Create account";
  $("#login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const body = JSON.stringify({ username: $("#login-user").value, password: $("#login-pass").value });
    const path = status.has_users ? "/auth/login" : "/auth/setup";
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) {
      $("#login-error").textContent = (await r.json().catch(() => ({}))).detail || "Sign-in failed.";
      return;
    }
    const data = await r.json();
    enterApp(data.user, false);
  });
  $("#demo-btn").addEventListener("click", async () => {
    const r = await fetch("/auth/demo", { method: "POST" });
    if (r.ok) enterApp("demo", true);
  });
}

function enterApp(user, demo) {
  isDemo = demo;
  window.__aryaUser = user;
  $("#view-login").hidden = true;
  $("#username").textContent = demo ? "demo" : user;
  $("#demobar").hidden = !demo;
  if (demo) {
    $("#chat-demo-note").hidden = false;
    $("#chat-input").disabled = true;
    $("#chat-send").disabled = true;
    $("#btn-mic").disabled = true;
    openShell();
    return;
  }
  api("/auth/token").then(t => {
    if (t.has_token) { openShell(); return; }
    // Connecting Muse is the first step of a new account.
    $("#view-connect").hidden = false;
    paintTokenRow($("#connect-token-row"));
    const finish = () => { $("#view-connect").hidden = true; openShell(); };
    $("#connect-done").onclick = finish;
    $("#connect-skip").onclick = finish;
  }).catch(() => openShell());
}

function openShell() {
  $("#app-main").hidden = false;
  $("#tabs").hidden = false;
  $("#userbar").hidden = false;
  show("view-home");
  refresh("view-home");
}
$("#signout").addEventListener("click", async ev => {
  ev.preventDefault();
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});
boot();
