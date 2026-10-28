"use strict";
/* Arya Quest — Stage B UI. Wires the Stage A engine (sessions,
 * optimizer, Shop-Off, friends, profile, badges) into the PWA.
 * UX laws (UX.md): one primary action per screen; the list is a
 * pull-up panel, never a page; each store trip is its own session,
 * switchable from the rail. All state comes from the API — nothing
 * on these screens is invented. */
const Q = {
  sessions: [],        // last GET /api/quest/sessions
  current: null,       // session open in a play view
  scene: null,         // SceneView driver for the hunt
  timer: null,         // hunt clock interval
  stack: [],           // quest view back-stack
  draft: null,         // new-hunt flow state
  racePrefill: "",     // opponent handle carried from Friends
  storeReports: [],    // open "not here" reports for the current store
  mine: [],            // My Stores (Stage E): directory rows + favorite
  sfFilter: "all",     // Find stores chip: all | quests | zip
  // The SceneView ladder: strip is the default (a store with no model
  // still plays in full); the player can switch rungs mid-hunt and
  // loses nothing — session state lives here, never in a driver.
  driverName: localStorage.getItem("arya-scene-driver") || "strip",
  // Navigation-first hunt (Discussion 35 + 36): the scene follows
  // the route on its own; walkTimer walks the view to the current
  // stop and `arrived` presents its pop. followHold = the player
  // took manual control (seated fallback) — the walk waits until
  // the next collect. expScene is the Express frame's strip view.
  walkTimer: null,
  walkTarget: -1,
  arrived: false,
  followHold: false,
  // Any-order collecting (Discussion 44): the stop the hunt
  // presents. -1 = no steer, the first uncollected stop presents.
  // A collect steers it to the next uncollected stop after the
  // one just grabbed (wrapping to the first uncollected).
  focusIdx: -1,
  mapNote: "",
  expScene: null,
  // Motion navigation (Discussion 33): the gyro look controller, and
  // the step-advance EXPERIMENT — behind the arya-steps flag, default
  // OFF (absent key = off). stepsHold = a manual navigation paused
  // step-advance until the next collect re-anchors it.
  motion: null,
  stepsOn: localStorage.getItem("arya-steps") === "1",
  stepDet: null,
  stepListening: false,
  stepU: 0,
  stepAnchorU: 0,
  stepsHold: false,
  // Shelf Scan (Discussion 37): "still" (one photo) or "live"
  // (viewfinder frame feed). The live sampler, camera stream, tick
  // timer, and wake lock live here; leaving the view tears them down.
  scanMode: "still",
  scanUrl: "",
  scanStream: null,
  scanTimer: null,
  scanWake: null,
  scanBusy: false,
  sampler: null,
  scanPrevArr: null,
  scanSentArr: null,
  scanPopsShown: false,
};

function stopHuntTimer() {
  if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
}

/* Stores with a rebuilt 3D model (the platform plane): squashed
 * store name -> the SceneView "cloud" manifest inside the PWA.
 * Assets are built by assistant/tools/prep_cloud.py from a shopper's
 * walkthrough (VGGT). A store not listed here has no model yet: it
 * plays in strip, and mapping it is the invitation. */
const STORE_MODELS = { traderjoes: "models/trader-joes/manifest.json" };
function qStoreModel(store) {
  return STORE_MODELS[qnorm(store).replace(/ /g, "")] || null;
}

/* Stores with a photo walk (the platform plane): squashed store
 * name -> the SceneView "photo" frames directory inside the PWA.
 * The photo walk is a mapped store's default view (Discussion
 * 43); the cloud stays one tap away as the alternate 3D view. */
const STORE_PHOTOS = { traderjoes: "models/trader-joes/frames-web" };
function qStorePhotos(store) {
  return STORE_PHOTOS[qnorm(store).replace(/ /g, "")] || null;
}

/* Which rung a hunt opens on. The player's own stored choice
 * (the scene toggle) wins when the store can serve it; else the
 * session's recorded rung — with two defaults corrected: a
 * session recorded under the old mapped default (cloud) opens
 * in the new one (photo), and a "strip" recorded for a mapped
 * store is the silent server/legacy default, not a choice (the
 * create path always states its rung; a real strip preference
 * lives in the toggle), so it too opens in photo. A rung the
 * store cannot serve falls back — photo needs a walk, cloud
 * needs a model, anything else is strip. */
function qResolveDriver(store, sessDriver) {
  const model = qStoreModel(store), photos = qStorePhotos(store);
  const stored = localStorage.getItem("arya-scene-driver");
  let drv = stored || sessDriver || (photos ? "photo" : "strip");
  if (!stored && photos && (sessDriver === "cloud" || sessDriver === "strip")) drv = "photo";
  if (drv === "photo" && !photos) drv = model ? "cloud" : "strip";
  if (drv === "cloud" && !model) drv = photos ? "photo" : "strip";
  return drv;
}

/* ---------------- navigation ---------------- */

function questShow(id) {
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== id; });
  if (id !== "view-hunt") { stopHuntTimer(); stopHuntMotion(); }
  paintHuntFrame(id);
  if (Q.stack[Q.stack.length - 1] !== id) Q.stack.push(id);
  window.scrollTo(0, 0);
}
function questBack() {
  Q.stack.pop();
  const prev = Q.stack[Q.stack.length - 1];
  // Hunt v2 item 5: Back returns to the screen the player came
  // from. A hunt or run comes back live (its view re-mounts on the
  // same session); Today comes back fresh.
  if ((prev === "view-hunt" || prev === "view-express") && Q.current) {
    if (prev === "view-hunt") openHunt(Q.current); else openExpress(Q.current);
    return;
  }
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== (prev || "view-home"); });
  stopHuntTimer(); stopHuntMotion();
  paintHuntFrame(prev || "view-home");
  window.scrollTo(0, 0);
  if (!prev || prev === "view-home") refresh("view-home");
}
/* The hunt and the Express run are full-screen frames (Discussion
 * 36): the store fills the viewport and the tab bar hides. Every
 * exit path funnels through here, so the frame always comes down. */
function paintHuntFrame(id) {
  const hunt = id === "view-hunt", exp = id === "view-express";
  document.body.classList.toggle("hunting", hunt || exp);
  const hv = $("#view-hunt"); if (hv) hv.classList.toggle("full", hunt);
  const ev = $("#view-express"); if (ev) ev.classList.toggle("full", exp);
  if (!hunt && !exp) qWalkStop();
  if (!exp) destroyExpScene();
  if (!hunt) stopScanLive(); // the camera never outlives the hunt view
}
document.addEventListener("click", ev => {
  const back = ev.target.closest(".qback");
  if (back) { ev.preventDefault(); questBack(); return; }
  const nav = ev.target.closest("[data-qnav]");
  if (nav) { questGo(nav.dataset.qnav); }
});
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => { Q.stack = []; stopHuntTimer(); stopHuntMotion(); paintHuntFrame(""); }));

function questGo(id) {
  if (id === "view-community") renderCommunity().catch(showErr);
  if (id === "view-race") renderRace().catch(showErr);
  if (id === "view-friends") renderFriends().catch(showErr);
  if (id === "view-stores-mine") renderMyStores().catch(showErr);
  if (id === "view-stores-find") renderFindStores().catch(showErr);
  questShow(id);
}

/* ---------------- shared helpers ---------------- */

function qnorm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function qProgress(sess) {
  const total = sess.items.length;
  const done = sess.items.filter(i => i.checked).length;
  return { done, total, left: total - done };
}
const QSTATE_LABEL = { not_started: "Not started", playing: "Playing", paused: "Paused", finished: "Finished · Receipt missing", done: "Finished · Receipt attached ✓" };
const QMODE_LABEL = { quest: "Quest", express: "Express" };

function qParseLines(text) {
  const out = [];
  for (const rawLine of String(text || "").split("\n")) {
    const s = rawLine.trim();
    if (!s) continue;
    let m = s.match(/^(\d+)\s*[x×]?\s+(.+)$/);
    if (m) { out.push({ name: m[2].trim(), qty: Number(m[1]) }); continue; }
    m = s.match(/^(.+?)\s*[x×]\s*(\d+)$/);
    if (m) { out.push({ name: m[1].trim(), qty: Number(m[2]) }); continue; }
    out.push({ name: s, qty: 1 });
  }
  return out;
}
function qDurText(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}
function qClock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
async function qLoadSessions() {
  const d = await api("/api/quest/sessions");
  Q.sessions = d.sessions;
  return Q.sessions;
}
function qSessionById(id) { return Q.sessions.find(s => s.id === id) || null; }
async function qSetState(sess, state) {
  const s = await post(`/api/quest/sessions/${sess.id}/state`, { state });
  Object.assign(sess, s);
  return sess;
}
async function qCheck(sess, itemName, checked) {
  const s = await post(`/api/quest/sessions/${sess.id}/check`, { item: itemName, checked });
  Object.assign(sess, s);
  return sess;
}
function qOpenSession(sess) {
  Q.current = sess;
  // A closed hunt (finished or receipt-attached) opens on its
  // Score — never back into Finish (Hunt v2 item 2).
  if (sess.state === "done" || sess.state === "finished") { openScore(sess); return; }
  if (sess.mode === "express") openExpress(sess); else openHunt(sess);
}
function qRailHtml(currentId) {
  return Q.sessions.map(s => {
    const p = qProgress(s);
    return `<button class="chip" data-rail="${esc(s.id)}" aria-pressed="${String(s.id === currentId)}" type="button">${esc(s.store)} · ${p.done}/${p.total}</button>`;
  }).join("");
}
document.addEventListener("click", ev => {
  const r = ev.target.closest("[data-rail]");
  if (!r) return;
  const s = qSessionById(r.dataset.rail);
  if (s && (!Q.current || s.id !== Q.current.id)) qOpenSession(s);
});

/* ---------------- Today hub ---------------- */

$("#quest-sessions").addEventListener("click", ev => {
  const b = ev.target.closest("[data-sess]");
  if (!b) return;
  const s = qSessionById(b.dataset.sess);
  if (s) qOpenSession(s);
});
$("#btn-new-hunt").addEventListener("click", () => {
  Q.draft = { raw: [], store: "", opt: null, baseItems: [], undone: {}, answers: {} };
  questShow("view-newlist");
});

/* ---------------- New hunt: add list ---------------- */

$("#nl-from-list").addEventListener("click", async () => {
  try {
    const h = await api("/api/home");
    if (!h.list.items.length) { toast("Your Arya list is empty right now."); return; }
    $("#nl-text").value = h.list.items.map(i => i.qty > 1 ? `${i.name} × ${qtyFmt(i.qty)}` : i.name).join("\n");
  } catch (e) { toast(e.message); }
});
$("#nl-next").addEventListener("click", async () => {
  const raw = qParseLines($("#nl-text").value);
  if (!raw.length) { toast("Add at least one item first."); return; }
  Q.draft.raw = raw;
  Q.draft.storeId = null;
  $("#st-name").value = "";
  // The pick reads My Stores (Stage E): favorites first, addresses
  // shown. Typed names stay possible for a store not in mine yet.
  try { await qLoadMine(); } catch (e) { Q.mine = []; }
  renderStorePick();
  questShow("view-store");
});

/* ---------------- Stores (Stage E) ----------------
 * The directory is the platform plane (shared by every player);
 * My Stores + favorites are the account plane. The pick, Find, and
 * My Stores all render the same joined rows from /api/stores/*. */

const QSCENE_LABEL = { cloud: "3D mapped · Quest ready", strip: "Plays in Strip" };
function qStarSvg(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;
}
function qStoreMeta(s) {
  return `${esc(s.street)}, ${esc(s.city)}, ${esc(s.state)} ${esc(s.zip)} · ${QSCENE_LABEL[s.scene] || ""}`;
}
async function qLoadMine() {
  const d = await api("/api/stores/mine");
  Q.mine = d.stores || [];
  return Q.mine;
}

function renderStorePick() {
  const box = $("#st-mine");
  if (!box) return;
  if (!Q.mine.length) {
    box.innerHTML = `<div class="group">${empty("No stores in your stores yet. Find one or add one below.")}</div>`;
    return;
  }
  const favs = Q.mine.filter(s => s.favorite);
  const rest = Q.mine.filter(s => !s.favorite);
  const rowHtml = s => `
    <button class="sessrow pickrow" data-pick="${esc(s.id)}" aria-pressed="${String(!!Q.draft && Q.draft.storeId === s.id)}" type="button">
      <span class="grow"><span class="name">${esc(s.name)}</span>
      <span class="sub">${qStoreMeta(s)}</span></span>
      ${s.favorite ? `<span class="starpick">${qStarSvg(true)}</span>` : ""}
    </button>`;
  let html = "";
  if (favs.length) html += `<h3 class="sect">Favorites</h3><div class="group">` + favs.map(rowHtml).join("") + `</div>`;
  if (rest.length) html += `<h3 class="sect">All my stores</h3><div class="group">` + rest.map(rowHtml).join("") + `</div>`;
  box.innerHTML = html;
}
document.addEventListener("click", ev => {
  const p = ev.target.closest("[data-pick]");
  if (!p || !Q.draft) return;
  const s = Q.mine.find(x => x.id === p.dataset.pick);
  if (!s) return;
  Q.draft.storeId = s.id;
  $("#st-name").value = s.name;
  renderStorePick();
});
$("#st-name").addEventListener("input", () => {
  if (!Q.draft || !Q.draft.storeId) return;
  const sel = Q.mine.find(x => x.id === Q.draft.storeId);
  if (sel && $("#st-name").value.trim() !== sel.name) {
    Q.draft.storeId = null;  // typed a different store: free-text trip
    renderStorePick();
  }
});

async function renderFindStores() {
  const q = $("#sf-q").value.trim();
  let rows = [];
  try {
    const d = await api(`/api/stores/search?q=${encodeURIComponent(q)}${Q.sfFilter === "quests" ? "&quests=1" : ""}`);
    rows = d.stores || [];
  } catch (e) { toast(e.message); }
  if (Q.sfFilter === "zip") {
    // "Near" = the same ZIP prefix area (first three digits): the
    // typed ZIP's area, or the first favorite's when nothing typed.
    let digits = q.replace(/\D/g, "");
    if (!digits) {
      if (!Q.mine.length) { try { await qLoadMine(); } catch (e) { Q.mine = []; } }
      const fav = Q.mine.find(s => s.favorite) || Q.mine[0];
      digits = fav ? fav.zip : "";
    }
    const prefix = digits.slice(0, 3);
    if (prefix) rows = rows.filter(s => s.zip.startsWith(prefix));
  }
  const box = $("#sf-results");
  if (!rows.length) {
    box.innerHTML = `<div class="group">${empty("No stores match. Add it — a new store joins the directory for everyone.")}</div>`;
    return;
  }
  box.innerHTML = `<div class="group">` + rows.map(s => `
    <div class="row"><div class="grow"><span class="name">${esc(s.name)}</span>
    <span class="sub">${qStoreMeta(s)}</span></div>
    ${s.in_mine ? `<span class="sub">Added ✓</span>` : `<button class="chip" data-addstore="${esc(s.id)}" type="button">Add</button>`}
    </div>`).join("") + `</div>`;
}
$("#sf-form").addEventListener("submit", ev => {
  ev.preventDefault();
  renderFindStores().catch(showErr);
});
$("#sf-chips").addEventListener("click", ev => {
  const b = ev.target.closest("[data-sfchip]");
  if (!b) return;
  Q.sfFilter = b.dataset.sfchip;
  document.querySelectorAll("#sf-chips .chip").forEach(c =>
    c.setAttribute("aria-pressed", String(c === b)));
  renderFindStores().catch(showErr);
});
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-addstore]");
  if (!b) return;
  b.disabled = true;
  try {
    await post("/api/stores/mine", { store_id: b.dataset.addstore });
    await qLoadMine().catch(() => {});
    renderFindStores().catch(showErr);
  } catch (e) { toast(e.message); b.disabled = false; }
});

async function renderMyStores() {
  try { await qLoadMine(); } catch (e) { Q.mine = []; }
  const box = $("#sm-list");
  if (!Q.mine.length) {
    box.innerHTML = `<div class="group">${empty("No stores yet. Find one or add one below.")}</div>`;
    return;
  }
  const favs = Q.mine.filter(s => s.favorite);
  const rest = Q.mine.filter(s => !s.favorite);
  const rowHtml = s => `
    <div class="row"><div class="grow"><span class="name">${esc(s.name)}</span>
    <span class="sub">${qStoreMeta(s)}</span></div>
    <button class="starbtn ${s.favorite ? "on" : ""}" data-fav="${esc(s.id)}" data-on="${String(s.favorite)}" aria-pressed="${String(s.favorite)}" aria-label="${s.favorite ? "Remove from favorites" : "Add to favorites"}" type="button">${qStarSvg(s.favorite)}</button></div>`;
  let html = "";
  if (favs.length) html += `<h3 class="sect">Favorites</h3><div class="group">` + favs.map(rowHtml).join("") + `</div>`;
  if (rest.length) html += `<h3 class="sect">All my stores</h3><div class="group">` + rest.map(rowHtml).join("") + `</div>`;
  box.innerHTML = html;
}
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-fav]");
  if (!b) return;
  try {
    await post("/api/stores/favorite",
      { store_id: b.dataset.fav, favorite: b.dataset.on !== "true" });
    renderMyStores().catch(showErr);
  } catch (e) { toast(e.message); }
});

$("#sa-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const body = {
    name: $("#sa-name").value.trim(), street: $("#sa-street").value.trim(),
    city: $("#sa-city").value.trim(), state: $("#sa-state").value.trim(),
    zip: $("#sa-zip").value.trim(),
  };
  if (!body.name || !body.street || !body.city || !body.state || !body.zip) {
    toast("Fill in the name and the whole address."); return;
  }
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const row = await post("/api/stores", body);
    toast(`${row.name} is in your stores.`);
    await qLoadMine().catch(() => {});
    questGo("view-stores-mine");
  } catch (e) { toast(e.message); }
  btn.disabled = false;
});

/* ---------------- New hunt: optimize ---------------- */

$("#st-next").addEventListener("click", async () => {
  const store = $("#st-name").value.trim();
  if (!store) { toast("Name the store first."); return; }
  Q.draft.store = store;
  const btn = $("#st-next");
  btn.disabled = true;
  try {
    const out = await post("/api/quest/optimize", { items: Q.draft.raw, store });
    Q.draft.opt = out;
    Q.draft.baseItems = out.items.map(i => ({ ...i }));
    Q.draft.undone = {};
    Q.draft.answers = {};
    // Quantities the questions must carry: summed from the raw lines.
    Q.draft.qQty = {};
    for (const r of Q.draft.raw) {
      const k = qnorm(r.name);
      Q.draft.qQty[k] = (Q.draft.qQty[k] || 0) + r.qty;
    }
    renderOptimize();
    questShow("view-optimize");
  } catch (e) { toast(e.message); }
  btn.disabled = false;
});

function qOptNextEnabled() {
  const qs = (Q.draft.opt && Q.draft.opt.report.questions) || [];
  const seen = new Set();
  let pending = 0;
  for (const q of qs) {
    if (seen.has(q.item)) continue;
    seen.add(q.item);
    if (!Q.draft.answers[q.item]) pending++;
  }
  $("#opt-next").disabled = pending > 0;
}
function renderOptimize() {
  const rep = Q.draft.opt.report;
  const parts = [`${rep.in} in`];
  if (rep.merged.length) parts.push(`${rep.merged.length} merged`);
  if (rep.corrected.length) parts.push(`${rep.corrected.length} corrected`);
  if (rep.questions.length) parts.push(`${rep.questions.length} to ask`);
  if (rep.unresolved.length) parts.push(`${rep.unresolved.length} kept as typed`);
  $("#opt-summary").textContent = parts.join(" · ");
  let html = "";
  if (rep.merged.length) {
    html += `<h3 class="sect">Merged</h3><div class="group">` + rep.merged.map(m =>
      row(esc(m.name), `added as ${m.from.map(esc).join(", ")}`, `× ${qtyFmt(m.qty)}`)).join("") + `</div>`;
  }
  if (rep.corrected.length) {
    html += `<h3 class="sect">Corrected</h3><div class="group">` + rep.corrected.map((c, ci) =>
      `<div class="row"><div class="grow"><span class="name">${esc(c.from)} &rarr; ${esc(c.to)}</span>
       <span class="sub">${Q.draft.undone[ci] ? "Kept as you typed it." : "Matched to your dictionary."}</span></div>
       ${Q.draft.undone[ci] ? "" : `<button class="chip" data-undo="${ci}" type="button">Undo</button>`}</div>`).join("") + `</div>`;
  }
  const seenQ = new Set();
  const questions = rep.questions.filter(q => !seenQ.has(q.item) && seenQ.add(q.item));
  if (questions.length) {
    html += `<h3 class="sect">One choice each</h3>` + questions.map(q => {
      const ans = Q.draft.answers[q.item];
      const chip = (val, label) =>
        `<button class="chip" data-q="${esc(q.item)}" data-ans="${esc(val)}" aria-pressed="${String(ans === val)}" type="button">${esc(label)}</button>`;
      return `<div class="group pad"><p class="nomargin"><strong>${esc(q.item)}</strong> — which one?</p>
        <div class="actions" style="padding-bottom:0">
          ${q.candidates.map(c => chip("cand:" + c.name, c.name)).join("")}
          ${chip("both", "Both")}
          ${chip("typed", "Keep as typed")}
        </div></div>`;
    }).join("");
  }
  if (rep.unresolved.length) {
    html += `<h3 class="sect">Kept as typed</h3><div class="group">` + rep.unresolved.map(u =>
      row(esc(u), "Not in your dictionary — it goes on the list exactly as written")).join("") + `</div>`;
  }
  if (!html) html = `<div class="group">${empty("Clean list. Nothing to merge, fix, or ask.")}</div>`;
  $("#opt-body").innerHTML = html;
  qOptNextEnabled();
}
$("#opt-body").addEventListener("click", ev => {
  const undo = ev.target.closest("[data-undo]");
  if (undo) {
    const ci = Number(undo.dataset.undo);
    const c = Q.draft.opt.report.corrected[ci];
    const item = Q.draft.baseItems.find(i => i.name === c.to && !i._undone);
    if (item) {
      item.name = c.from;
      item.group = "name:" + qnorm(c.from);
      item._undone = true;
    }
    Q.draft.undone[ci] = true;
    renderOptimize();
    return;
  }
  const chipBtn = ev.target.closest("[data-q]");
  if (chipBtn) {
    Q.draft.answers[chipBtn.dataset.q] = chipBtn.dataset.ans;
    renderOptimize();
  }
});
$("#opt-next").addEventListener("click", () => {
  const items = Q.draft.baseItems.map(i => ({ name: i.name, qty: i.qty, group: i.group }));
  const seenQ = new Set();
  for (const q of Q.draft.opt.report.questions) {
    if (seenQ.has(q.item)) continue;
    seenQ.add(q.item);
    const ans = Q.draft.answers[q.item];
    const qty = Q.draft.qQty[qnorm(q.item)] || 1;
    if (!ans) continue; // unreachable: the button stays disabled
    if (ans === "both") {
      q.candidates.forEach(c => items.push({ name: c.name, qty }));
    } else if (ans === "typed") {
      items.push({ name: q.item, qty, group: "name:" + qnorm(q.item) });
    } else if (ans.startsWith("cand:")) {
      items.push({ name: ans.slice(5), qty });
    }
  }
  Q.draft.finalItems = items;
  questShow("view-mode");
});

/* ---------------- New hunt: mode choose ---------------- */

document.querySelectorAll(".modecard").forEach(b =>
  b.addEventListener("click", async () => {
    const mode = b.dataset.mode;
    b.disabled = true;
    try {
      const sess = await post("/api/quest/sessions",
        { store: Q.draft.store, mode, items: Q.draft.finalItems,
          store_id: Q.draft.storeId || undefined,
          driver: qStorePhotos(Q.draft.store) ? "photo" : Q.driverName });
      await qLoadSessions().catch(() => {});
      toast(`${QMODE_LABEL[mode]} at ${sess.store} — ready when you are.`);
      // The set-up screens are done with: Back from the new hunt
      // returns to Today, not into the mode picker again.
      Q.stack = [];
      qOpenSession(sess);
    } catch (e) { toast(e.message); }
    b.disabled = false;
  }));

/* ---------------- Navigation-first hunt (Discussion 35 + 36) ----
 * The hunt is navigation, not a viewer. The scene follows the
 * route: qWalkStart glides the view to the current stop and, after
 * a sane walk interval, the stop "arrives" — its pop rises with
 * the one big GRAB. In the demo the walk is simulated on a timer
 * (judges are seated); in the store the same arrival is anchored
 * by position. Manual navigation (a touch on the scene, a view
 * switch) holds the walk and presents the stop at once — the
 * seated fallback always works. The route strip and the up-next
 * overlay are pure functions of the session, in route order. */
const WALK_MS = { quest: 3200, express: 2000 };
const PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>`;
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>`;
function paintPauseBtn(sel, paused, disabled) {
  const b = $(sel);
  if (!b) return;
  b.innerHTML = paused ? PLAY_SVG : PAUSE_SVG;
  b.setAttribute("aria-label", paused ? "Resume" : "Pause");
  b.disabled = !!disabled;
}
function qStopU(sess, i) {
  const it = sess.items[i];
  if (it && it.shelf_u != null) return Math.max(0, Math.min(1, it.shelf_u));
  const n = Math.max(1, sess.items.length);
  return (i + 0.5) / n;
}
/* Hunt v2: the one list, in route order, in flow under the store
 * view. Rows never move or re-sort; a collected row keeps its
 * place and swaps its GRAB for "Put back" in the same button box. */
function qHuntListHtml(sess) {
  const stops = qStops(sess);
  const cur = qCurrentIndex(sess);
  const live = sess.state === "playing";
  return sess.items.map((it, i) => {
    const s = stops[i];
    const sub = [s.shelfLabel || (s.unplaced ? "Not placed on the map" : ""),
                 s.flagged ? "Reported missing" : ""].filter(Boolean).join(" · ");
    const act = it.checked
      ? `<button type="button" class="btn rowact putback" data-putback="${i}"${live || sess.state === "paused" ? "" : " disabled"}>↩ Put back</button>`
      : `<button type="button" class="btn primary rowact" data-grab="${i}"${live ? "" : " disabled"}>Grab</button>`;
    return `<div class="row huntrow${it.checked ? " got" : ""}${i === cur ? " next" : ""}">
      <span class="hl-n">${it.checked ? "✓" : i + 1}</span>
      <div class="grow"><span class="name">${esc(it.name)}${it.qty > 1 ? ` · × ${qtyFmt(it.qty)}` : ""}</span>
      ${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>
      ${act}
    </div>`;
  }).join("") || empty("The list is empty.");
}
/* Express v2: the list in walking order, and each row is the
 * check — the whole row is the tap target. */
function qExpListHtml(sess) {
  const stops = qStops(sess);
  const next = qNextIndex(sess);
  return sess.items.map((it, i) => {
    const s = stops[i];
    return `<button type="button" class="row listrow exprow${it.checked ? " checked" : ""}${i === next ? " next" : ""}" data-exp-check="${esc(it.name)}" aria-pressed="${String(!!it.checked)}">
      <span class="check" aria-hidden="true">${CHECK_SVG}</span>
      <span class="grow"><span class="name">${esc(it.name)}</span>
      ${s.shelfLabel ? `<span class="sub">${esc(s.shelfLabel)}</span>` : ""}
      ${s.flagged ? `<span class="repflag">Reported missing at this store.</span>` : ""}</span>
      <span class="money">× ${qtyFmt(it.qty)}</span>
    </button>`;
  }).join("") || empty("The list is empty.");
}
/* What the arrival pop shows: "ready" before the start, "stop"
 * when the followed position has reached the current stop (or the
 * player is navigating by hand), "done" when nothing is left,
 * "hidden" while the walk is still traveling. */
function qPopState(sess) {
  if (sess.state === "not_started") return "ready";
  if (sess.state !== "playing" && sess.state !== "paused") return "hidden";
  if (qNextIndex(sess) === -1) return "done";
  return Q.arrived ? "stop" : "hidden";
}
function renderCurrent() {
  const s = Q.current;
  if (!s) return;
  if (s.mode === "express") renderExpress(); else renderHunt();
}
function qWalkStop() {
  if (Q.walkTimer) { clearTimeout(Q.walkTimer); Q.walkTimer = null; }
  Q.walkTarget = -1;
}
function qWalkStart(idx) {
  qWalkStop();
  Q.walkTarget = idx;
  Q.arrived = false;
  const sess = Q.current;
  if (!sess || idx < 0) return;
  const scene = sess.mode === "express" ? Q.expScene : Q.scene;
  if (scene) scene.glideTo(idx);
  if (Q.followHold || sess.state !== "playing") { Q.arrived = true; return; }
  Q.walkTimer = setTimeout(() => {
    Q.walkTimer = null;
    Q.arrived = true;
    renderCurrent();
  }, WALK_MS[sess.mode] || WALK_MS.quest);
}
/* Manual navigation: the walk holds, the current stop presents
 * itself at once, and step/walk resumes only at the next collect. */
function qFollowHold() {
  Q.followHold = true;
  if (Q.walkTimer) {
    clearTimeout(Q.walkTimer);
    Q.walkTimer = null;
    Q.arrived = true;
    renderCurrent();
  }
}
/* The collect hook: the celebration (Discussion 32 — the item as an
 * animated character with one fun fact) fires from here. GRAB and
 * marker taps collect through collectCurrent; panel checks and
 * Shelf Scan pops route here too, so the celebration has exactly
 * one home. Hunt state is already recorded when this runs — the
 * celebration never delays or gates a collect, and "Not here"
 * never fires it. Facts come from the verified static bank in
 * assets/characters/manifest.json: fun facts only, no nutrition
 * or health claims, nothing improvised at runtime. */
let CELEB = null;          // the manifest, once loaded
let celebTimer = null;     // the one auto-dismiss timer — never stacked
function qCelebLoad() {
  if (CELEB) return;
  CELEB = { items: [], categories: [] };  // until the manifest lands
  try {
    fetch("assets/characters/manifest.json").then(r => r.json())
      .then(m => { CELEB = m; }).catch(() => {});
  } catch (e) { /* no fetch (test harness) — celebrations stay off */ }
}
function qCelebSetManifest(m) { CELEB = m; }  // test seam
function qCelebMatch(tokens, kw) {
  const kt = kw.split(" ");
  for (let i = 0; i + kt.length <= tokens.length; i++)
    if (kt.every((w, j) => tokens[i + j] === w)) return true;
  return false;
}
/* Resolution: an exact item rule wins for character and fact
 * independently; then the first matching category; else none. */
function qCelebResolve(name, manifest) {
  if (!manifest) return null;
  const tokens = qnorm(name).split(" ").filter(Boolean);
  let item = null, cat = null;
  for (const r of manifest.items || [])
    if (!item && (r.keywords || []).some(k => qCelebMatch(tokens, k))) item = r;
  for (const c of manifest.categories || [])
    if (!cat && (c.keywords || []).some(k => qCelebMatch(tokens, k))) cat = c;
  const char = (item && item.char) || (cat && cat.char) || null;
  const fact = (item && item.fact) || (cat && cat.fact) || null;
  if (!char && !fact) return null;
  return { char, fact };
}
function qCelebHide() {
  if (celebTimer) { clearTimeout(celebTimer); celebTimer = null; }
  const layer = $("#celeb-layer");
  if (layer) { layer.hidden = true; layer.innerHTML = ""; }
}
function qCelebrate(name) {
  const hit = qCelebResolve(name, CELEB);
  const layer = $("#celeb-layer");
  if (!hit || !layer) return;
  if (celebTimer) { clearTimeout(celebTimer); celebTimer = null; }
  layer.innerHTML =
    (hit.char ? `<img class="celeb-char" src="assets/characters/${esc(hit.char)}" alt="">` : "") +
    (hit.fact ? `<div class="celeb-bubble">${esc(hit.fact)}</div>` : "");
  layer.hidden = false;
  celebTimer = setTimeout(qCelebHide, 3500);
}
function qOnCollected(name) {
  // Discussion 32: Quest mode only — Express never celebrates.
  if (!Q.current || Q.current.mode !== "quest") return;
  qCelebLoad();
  qCelebrate(name);
}
$("#celeb-layer").addEventListener("click", qCelebHide);

/* ---------------- Hunt (Quest mode) ---------------- */

function qNextIndex(sess) {
  return sess.items.findIndex(i => !i.checked);
}
/* The stop the hunt presents (Discussion 44). The route is a
 * recommendation, not a rail: any stop can be grabbed, so the
 * presented stop is a steer (Q.focusIdx), not simply the first
 * uncollected one. A stale steer — collected, out of range —
 * falls back to the first uncollected stop. Express keeps
 * first-uncollected semantics: its checks are toggles. */
function qCurrentIndex(sess) {
  if (!sess) return -1;
  if (sess.mode !== "quest") return qNextIndex(sess);
  const f = Q.focusIdx;
  if (f >= 0 && f < sess.items.length && !sess.items[f].checked) return f;
  return qNextIndex(sess);
}
/* After a collect at idx, steer the hunt: the next uncollected
 * stop after it, else the first uncollected, else -1 (done). */
function qRetarget(sess, idx) {
  let t = sess.items.findIndex((it, i) => i > idx && !it.checked);
  if (t === -1) t = qNextIndex(sess);
  Q.focusIdx = t;
  return t;
}
function qStops(sess) {
  const flagged = new Set(Q.storeReports.map(r => r.item_group || qnorm(r.item)));
  return sess.items.map(i => ({
    name: i.name, qty: i.qty, checked: i.checked,
    flagged: flagged.has(i.group) || flagged.has(qnorm(i.name)),
    // Item–shelf matching (server-side at session creation): a
    // matched stop carries its shelf label + path position; an
    // unmatched stop in a graphed store is honestly "unplaced";
    // a store with no graph sets neither field.
    shelfLabel: i.shelf_label || null,
    shelfU: (i.shelf_u === undefined ? null : i.shelf_u),
    shelfSide: i.shelf_side || null,
    unplaced: i.shelf_label !== undefined && i.shelf_u == null
  }));
}
async function qLoadStoreReports(store) {
  try {
    const d = await api(`/api/quest/stores/${encodeURIComponent(store)}/reports`);
    Q.storeReports = d.reports || [];
  } catch (e) { Q.storeReports = []; }
}
function startHuntTimer(sess) {
  stopHuntTimer();
  const paint = () => {
    const el = $("#hunt-timer");
    if (!el || !sess.started_at) return;
    const end = sess.finished_at ? new Date(sess.finished_at).getTime() : Date.now();
    el.textContent = qClock(end - new Date(sess.started_at).getTime());
  };
  paint();
  Q.timer = setInterval(paint, 1000);
}
function paintSceneToggle() {
  const hasModel = !!(Q.current && qStoreModel(Q.current.store));
  const hasPhotos = !!(Q.current && qStorePhotos(Q.current.store));
  document.querySelectorAll("#scene-toggle [data-driver]").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.driver === Q.driverName));
    if (b.dataset.driver === "cloud") b.disabled = !hasModel;
    if (b.dataset.driver === "photo") b.disabled = !hasPhotos;
  });
}
function mountScene() {
  const mount = $("#scene-mount");
  if (Q.scene) Q.scene.destroy();
  mount.dataset.model = (Q.current && qStoreModel(Q.current.store)) || "";
  mount.dataset.photos = (Q.current && qStorePhotos(Q.current.store)) || "";
  Q.scene = createSceneView(mount, Q.driverName);
  Q.scene.onTapStop = idx => qTapStop(idx);
  paintSceneToggle();
}
$("#scene-toggle").addEventListener("click", ev => {
  const b = ev.target.closest("[data-driver]");
  if (!b || b.dataset.driver === Q.driverName) return;
  Q.stepsHold = true; // switching the view is manual navigation
  // Drop a rung (or climb one) mid-hunt: the driver is only a view —
  // stops, checks, and the clock live in the session, untouched.
  // Switching the view by hand is manual navigation: the walk holds.
  qFollowHold();
  Q.driverName = b.dataset.driver;
  localStorage.setItem("arya-scene-driver", Q.driverName);
  mountScene();
  renderHunt();
});
/* A touch on the scene is manual navigation (the seated fallback):
 * the auto-follow holds until the next collect. */
$("#scene-mount").addEventListener("pointerdown", () => qFollowHold());
$("#exp-mount").addEventListener("pointerdown", () => qFollowHold());
function openHunt(sess) {
  Q.current = sess;
  qCelebLoad();  // warm the celebration manifest before the first collect
  questShow("view-hunt");
  $("#hunt-rail").innerHTML = qRailHtml(sess.id);
  const model = qStoreModel(sess.store);
  const photos = qStorePhotos(sess.store);
  // Reopen on the session's rung, resolved against what this
  // store can serve (the mapped default is the photo walk).
  Q.driverName = qResolveDriver(sess.store, sess.driver);
  mountScene();
  Q.mapNote = !model && !photos
    ? `No map for ${sess.store} yet — map this store to unlock its photo walk and 3D view. The hunt plays the same either way.`
    : Q.driverName === "strip"
      ? `This store is mapped — switch to Photos or 3D above. The hunt plays the same either way.`
      : "";
  Q.followHold = false;
  Q.focusIdx = -1; // a fresh entry presents the first uncollected stop
  renderHunt();
  startHuntTimer(sess);
  qInitMotion();
  qWalkStart(qCurrentIndex(sess));
  qLoadStoreReports(sess.store).then(() => { if (Q.current === sess) renderHunt(); });
}
function renderHunt() {
  const sess = Q.current;
  if (!sess) return;
  const p = qProgress(sess);
  const next = qCurrentIndex(sess);
  if (Q.scene) {
    Q.scene.setStops(qStops(sess));
    Q.scene.setNext(next);
  }
  $("#hunt-store").textContent = `${sess.store} · ${QMODE_LABEL[sess.mode] || sess.mode}`;
  $("#hunt-count").textContent = `${p.done}/${p.total}`;
  $("#hunt-mapnote").textContent = Q.mapNote || "";
  $("#hunt-mapnote").hidden = !Q.mapNote;
  $("#hunt-list").innerHTML = qHuntListHtml(sess);
  // The suggested-next card: always the one target, never a wait
  // on the walk — the route is a suggestion, any row can GRAB.
  const ps = qPopState(sess);
  const allIn = ps === "done";
  $("#hunt-pop").hidden = allIn;
  $("#hunt-done-note").hidden = !allIn;
  const btn = $("#btn-collect");
  if (ps === "ready") {
    const first = sess.items[0];
    $("#pop-kicker").textContent = "Ready when you are";
    $("#pop-body").innerHTML = `<p class="pop-name">${p.total} item${p.total === 1 ? "" : "s"}</p>
      <p class="pop-shelf">First stop: ${first ? esc(first.name) : "—"}.</p>`;
    btn.textContent = "Start the hunt";
    btn.disabled = false;
    $("#btn-nothere").disabled = true;
  } else if (!allIn && next >= 0) {
    const it = sess.items[next];
    const stop = qStops(sess)[next];
    const rep = Q.storeReports.find(r => (r.item_group && r.item_group === it.group) || qnorm(r.item) === qnorm(it.name));
    $("#pop-kicker").textContent = sess.state === "paused" ? "Paused" : "Suggested next — grab any stop";
    $("#pop-body").innerHTML = `<p class="pop-name">${esc(it.name)}${it.qty > 1 ? ` · × ${qtyFmt(it.qty)}` : ""}</p>
      ${stop.shelfLabel ? `<p class="pop-shelf">${esc(stop.shelfLabel)}</p>` : stop.unplaced ? `<p class="pop-shelf">Not placed on the map</p>` : ""}
      ${rep ? `<p style="margin:6px 0 0"><span class="repflag">Reported missing — another hunter could not find it here.</span></p>` : ""}`;
    btn.textContent = `Grab · ${it.name}`;
    btn.disabled = sess.state !== "playing";
    $("#btn-nothere").disabled = sess.state !== "playing";
  }
  $("#btn-nothere").hidden = allIn;
  paintPauseBtn("#btn-pause", sess.state === "paused", sess.state === "not_started");
  $("#btn-finish").disabled = sess.state === "not_started";
  $("#hunt-rail").innerHTML = qRailHtml(sess.id);
  // Shelf Scan is the unmapped-store mode: present on the Strip
  // rung, absent in a mapped (Cloud) hunt.
  $("#btn-scan").hidden = Q.driverName !== "strip";
  // Where am I? gates on the store being MAPPED, not on a rung:
  // the anchor is a path fraction, so it works on the Photo and
  // Cloud views alike (it shares the tools row with Shelf Scan,
  // which stays Strip-only — the two never coexist).
  $("#btn-locate").hidden = !(Q.driverName === "cloud" || Q.driverName === "photo");
  qStepSync();
}
/* Collect one stop by index (Discussion 44): the GRAB on the
 * suggested-next card, the list-row GRABs, and marker taps all
 * land here.
 * Any order — after the grab the hunt re-targets to the next
 * uncollected stop after this one (wrapping to the first
 * uncollected), and the walk and step anchor follow it. */
async function collectStop(idx) {
  const sess = Q.current;
  if (!sess || idx < 0 || idx >= sess.items.length) return;
  if (sess.state !== "playing" || sess.items[idx].checked) return;
  const name = sess.items[idx].name;
  try {
    await qCheck(sess, name, true);
    qOnCollected(name);
    Q.followHold = false; // the walk resumes from the new anchor
    const target = qRetarget(sess, idx);
    renderHunt();
    qStepAnchorTo(name); // a collect is ground truth for step-advance
    qWalkStart(target);
    // At N/N the hunt waits for the player's Finish — collecting
    // the last item never jumps to the Finish screen (Hunt v2 item 2).
    if (target === -1) toast("All collected. Tap Finish when you're ready.");
  } catch (e) { toast(e.message); }
}
function collectCurrent() { return collectStop(qCurrentIndex(Q.current)); }
/* Put back (Hunt v2 item 2): the collected row flips back in place.
 * Counts and the suggested next re-aim; the scene walk does not
 * restart. */
async function putBackStop(idx) {
  const sess = Q.current;
  if (!sess || idx < 0 || idx >= sess.items.length) return;
  if (sess.state !== "playing" && sess.state !== "paused") return;
  if (!sess.items[idx].checked) return;
  try {
    await qCheck(sess, sess.items[idx].name, false);
    if (qCurrentIndex(sess) === -1 || Q.focusIdx === -1) Q.focusIdx = idx;
    renderHunt();
  } catch (e) { toast(e.message); }
}
/* A marker tap (Discussion 44): tapping the presented stop's
 * marker grabs it, as before; tapping any other stop's marker
 * opens that stop's card — the hunt steers to it and its arrival
 * pop rises with the GRAB enabled. A touch on the scene has
 * already held the walk (manual navigation), so the card
 * presents at once; left unheld, the walk glides over and the
 * pop rises on arrival, as usual. Checked stops do nothing. */
function qTapStop(idx) {
  const sess = Q.current;
  if (!sess || sess.mode !== "quest" || sess.state !== "playing") return;
  if (idx === qCurrentIndex(sess)) { collectCurrent(); return; }
  if (idx < 0 || idx >= sess.items.length || sess.items[idx].checked) return;
  Q.focusIdx = idx;
  qWalkStart(idx);
  renderHunt();
}
$("#btn-collect").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  if (sess.state === "not_started") {
    try {
      await qSetState(sess, "playing");
      renderHunt();
      startHuntTimer(sess);
      qWalkStart(qCurrentIndex(sess));
    }
    catch (e) { toast(e.message); }
    return;
  }
  collectCurrent();
});
/* List-row GRABs (Discussion 44): every row collects its own stop
 * directly — any order — and a collected row puts back in place. */
$("#hunt-list").addEventListener("click", ev => {
  const g = ev.target.closest("[data-grab]");
  if (g && !g.disabled) { collectStop(Number(g.dataset.grab)); return; }
  const u = ev.target.closest("[data-putback]");
  if (u && !u.disabled) putBackStop(Number(u.dataset.putback));
});
$("#btn-pause").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try {
    const to = sess.state === "paused" ? "playing" : "paused";
    await qSetState(sess, to);
    if (to === "paused") qWalkStop(); // freeze mid-walk; the pop stays as it was
    renderHunt();
    if (to === "playing" && !Q.arrived) qWalkStart(qCurrentIndex(sess));
  } catch (e) { toast(e.message); }
});
$("#btn-finish").addEventListener("click", () => {
  // The hunt stays open until the Finish screen closes it, so
  // Finish's Back returns to a live hunt (Hunt v2 item 5).
  if (Q.current) openFinish(Q.current);
});

/* "Not here" — the Spotter report (store drift). Two taps: the
 * action, then what you see. The report flags the stop for other
 * hunters and earns nothing by itself — rewards land on truth,
 * when time resolves it, never on the report. */
let spotKind = null;
function openSpotSheet() {
  const sess = Q.current;
  const next = sess ? qCurrentIndex(sess) : -1;
  if (!sess || next === -1) return;
  spotKind = null;
  $("#spot-item").textContent = `At the stop for ${sess.items[next].name} — what do you see?`;
  document.querySelectorAll("#spot-sheet [data-kind]").forEach(b =>
    b.setAttribute("aria-pressed", "false"));
  $("#spot-photo").value = "";
  $("#spot-send").disabled = true;
  $("#spot-sheet").hidden = false;
}
function closeSpotSheet() { $("#spot-sheet").hidden = true; }
$("#btn-nothere").addEventListener("click", openSpotSheet);
$("#spot-close").addEventListener("click", closeSpotSheet);
$("#spot-sheet").addEventListener("click", ev => {
  if (ev.target.id === "spot-sheet") closeSpotSheet();
  const b = ev.target.closest("[data-kind]");
  if (b) {
    spotKind = b.dataset.kind;
    document.querySelectorAll("#spot-sheet [data-kind]").forEach(x =>
      x.setAttribute("aria-pressed", String(x === b)));
    $("#spot-send").disabled = false;
  }
});
$("#spot-send").addEventListener("click", async () => {
  const sess = Q.current;
  const next = sess ? qCurrentIndex(sess) : -1;
  if (!sess || next === -1 || !spotKind) return;
  const f = $("#spot-photo").files[0];
  const btn = $("#spot-send");
  btn.disabled = true;
  try {
    await post(`/api/quest/sessions/${sess.id}/report-missing`, {
      item: sess.items[next].name, kind: spotKind,
      photo: f ? f.name : undefined
    });
    closeSpotSheet();
    toast("Reported — other hunters will confirm.");
    await qLoadStoreReports(sess.store);
    renderHunt();
  } catch (e) { toast(e.message); btn.disabled = false; }
});

/* ---------------- Motion navigation (Discussion 33) ----------------
 * Gyro look: the SceneView motion layer (scene.js) turns the view
 * as the phone turns. One tap on "Look around with your phone" is
 * the iOS permission gesture; Android needs none. Absent a sensor
 * or a grant, the hunt is exactly today's — the button simply never
 * appears or quietly stops. Drag and tap always remain.
 *
 * Step-advance is an EXPERIMENT behind the arya-steps flag (default
 * off; the toggle chip shows on the demo account only). Walking
 * advances the view's path fraction toward the next stop, never
 * past it; every COLLECT re-anchors to the collected stop (collects
 * are ground truth), and any manual navigation — a touch on the
 * scene, a driver switch — holds step-advance until that collect. */
function qGyroAvailable() { return typeof DeviceOrientationEvent !== "undefined"; }
function qStepsVisible() { return typeof isDemo !== "undefined" && isDemo; }
function paintGyroBtn() {
  const b = $("#btn-gyro");
  if (!b) return;
  const on = !!(Q.motion && Q.motion.on);
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "Stop phone look" : "Look around with your phone";
}
function paintStepsBtn() {
  const b = $("#btn-steps");
  if (!b) return;
  b.setAttribute("aria-pressed", String(Q.stepsOn));
  b.textContent = Q.stepsOn ? "Steps advance · on (experiment)" : "Steps advance · experiment";
}
function paintMotionRow() {
  const gyro = qGyroAvailable();
  $("#btn-gyro").hidden = !gyro;
  $("#btn-steps").hidden = !qStepsVisible();
  $("#motion-row").hidden = !(gyro || qStepsVisible());
  paintGyroBtn();
  paintStepsBtn();
}
function qInitMotion() {
  if (!Q.motion) {
    Q.motion = createMotionLook(() => Q.scene, $("#scene-mount"));
    Q.motion.onUnavailable = () => {
      // The sensor exists but reports nothing (a desktop): retire
      // the button for this hunt, no message, hunt unchanged.
      $("#btn-gyro").hidden = true;
      $("#motion-row").hidden = !qStepsVisible();
      paintGyroBtn();
    };
  }
  paintMotionRow();
  qStepReset();
  qStepSync();
}
function stopHuntMotion() {
  if (Q.motion && Q.motion.on) Q.motion.stop();
  if (Q.stepListening) {
    window.removeEventListener("devicemotion", qOnMotion);
    Q.stepListening = false;
  }
  paintGyroBtn();
}
$("#btn-gyro").addEventListener("click", async () => {
  if (!Q.motion) qInitMotion();
  if (Q.motion.on) { Q.motion.stop(); paintGyroBtn(); return; }
  const ok = await Q.motion.start();
  if (!ok) toast("Phone look is not available — drag and tap still work.");
  paintGyroBtn();
});
$("#btn-steps").addEventListener("click", async () => {
  if (!Q.stepsOn) {
    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission().catch(() => "denied");
      if (res !== "granted") { toast("Steps need motion permission — they stay off."); return; }
    }
    Q.stepsOn = true;
    localStorage.setItem("arya-steps", "1");
    qStepReset();
  } else {
    Q.stepsOn = false;
    localStorage.removeItem("arya-steps");
  }
  paintStepsBtn();
  qStepSync();
});
/* Manual navigation holds step-advance: any touch on the scene. */
$("#scene-mount").addEventListener("pointerdown", () => { Q.stepsHold = true; });

function qStepReset() {
  const sess = Q.current;
  if (!sess) return;
  let anchor = 0;
  sess.items.forEach((it, i) => { if (it.checked) anchor = qStopU(sess, i); });
  Q.stepAnchorU = anchor;
  Q.stepU = anchor;
  Q.stepsHold = false;
}
function qStepAnchorTo(name) {
  const sess = Q.current;
  if (!sess) return;
  const i = sess.items.findIndex(it => it.name === name);
  if (i < 0) return;
  Q.stepAnchorU = qStopU(sess, i);
  Q.stepU = Q.stepAnchorU;
  Q.stepsHold = false;
  if (Q.stepsOn && Q.scene && Q.scene.setProgress) Q.scene.setProgress(Q.stepU);
}
function qStepSync() {
  const huntOpen = !$("#view-hunt").hidden;
  const want = Q.stepsOn && huntOpen && !!Q.current && Q.current.mode === "quest";
  if (want && !Q.stepListening) {
    Q.stepDet = createStepDetector(() => qStepAdvance());
    window.addEventListener("devicemotion", qOnMotion);
    Q.stepListening = true;
  } else if (!want && Q.stepListening) {
    window.removeEventListener("devicemotion", qOnMotion);
    Q.stepListening = false;
  }
}
function qOnMotion(e) {
  if (!Q.stepDet || Q.stepsHold || !Q.current || Q.current.state !== "playing") return;
  Q.stepDet.sample(e.accelerationIncludingGravity, performance.now());
}
function qStepAdvance() {
  const sess = Q.current;
  if (!sess || !Q.scene || !Q.scene.setProgress) return;
  const next = qCurrentIndex(sess);
  if (next === -1) return;
  const nextU = qStopU(sess, next);
  const u = MotionMath.advance(Q.stepU, nextU,
    MotionMath.segmentStepU(Q.stepAnchorU, nextU));
  if (u !== Q.stepU) { Q.stepU = u; Q.scene.setProgress(u); }
}

/* ---------------- Where am I? (localizer) ----------------
 * The position anchor for a mapped (Cloud) hunt. The server
 * matches a photo against the store's walkthrough index
 * (Wonder-authored matcher, no model calls) and answers a path
 * fraction; the client snaps it to the nearest stop and the
 * follow resumes from there. On the Strip rung the same corner
 * slot carries Shelf Scan instead — never both. */
function qAnchorToU(u) {
  const sess = Q.current;
  if (!sess || !sess.items.length) return -1;
  let best = 0, bestD = Infinity;
  sess.items.forEach((it, i) => {
    const d = Math.abs(qStopU(sess, i) - u);
    if (d < bestD) { bestD = d; best = i; }
  });
  // An anchor is ground truth, like a collect: the follow
  // resumes, step-advance re-bases here, the view jumps to the
  // photo's place on the path.
  Q.followHold = false;
  Q.stepAnchorU = u; Q.stepU = u; Q.stepsHold = false;
  if (Q.scene && Q.scene.setProgress) Q.scene.setProgress(u);
  // Present the anchored stop itself; if it is already in the
  // basket, present the next uncollected stop ahead of it.
  let target = best;
  if (sess.items[target].checked) {
    target = sess.items.findIndex((it, i) => i > best && !it.checked);
    if (target < 0) target = qNextIndex(sess);
  }
  Q.focusIdx = target; // the presented stop is the anchored one
  qWalkStart(target);
  return best;
}
async function locateFromPhoto(file) {
  const sess = Q.current;
  if (!sess) return;
  const r = await fetch(`/api/quest/locate?session=${encodeURIComponent(sess.id)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  const out = await r.json();
  if (out.found) {
    const idx = qAnchorToU(out.u);
    const stop = qStops(sess)[idx];
    toast(`Placed you at ${stop && stop.shelfLabel ? stop.shelfLabel : sess.items[idx].name}`);
  } else {
    toast("Couldn't place that photo — keep following the route.");
  }
}
$("#btn-locate").addEventListener("click", () => $("#locate-photo").click());
$("#locate-photo").addEventListener("change", ev => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (f) locateFromPhoto(f).catch(showErr);
});

/* ---------------- Shelf Scan (Discussion 37) ----------------
 * The unmapped-store mode. SAM proposes boxes for the remaining
 * list, Spark verifies, verified items pop over the view. Tapping
 * a pop collects that item — through qCheck and the same
 * qOnCollected hook as the GRAB, so the celebration (sub-stage 2)
 * fires identically. A scan that spots nothing says so plainly;
 * it never claims the item is not here.
 *
 * Two feed shapes, one endpoint: STILL (one photo) and LIVE (the
 * viewfinder). Live sends still frames — no video streaming: the
 * model chain takes ~4–8 s a frame, so the view is near-live and
 * the last scan's time is shown, not hidden. */
const SCAN_NO_POP = "Nothing from your list spotted here — that doesn't mean it isn't here. Keep looking.";
$("#btn-scan").addEventListener("click", () => openScanView().catch(showErr));
$("#scan-photo").addEventListener("change", ev => {
  const f = ev.target.files[0];
  if (f) scanStill(f).catch(showErr);
});
$("#scan-close").addEventListener("click", closeScan);
$("#scan-usephoto").addEventListener("click", () => $("#scan-photo").click());
$("#scan-stop").addEventListener("click", () => {
  stopScanLive();
  $("#scan-status").textContent = "Live scan stopped.";
});
async function scanRequest(body, sess) {
  const r = await fetch(`/api/quest/scan-shelf?session=${encodeURIComponent(sess.id)}`, {
    method: "POST",
    headers: { "Content-Type": body.type || "image/jpeg" },
    body
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
function scanPopsHtml(pops) {
  return pops.map(p => {
    const [x1, y1, x2, y2] = p.box;
    return `<button class="scanpop${p.grade === "region" ? " region" : ""}" type="button"
      data-item="${esc(p.item)}"
      style="left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%">
      <span class="poplabel">${esc(p.item)}${p.grade === "region" ? " · this shelf" : ""}</span></button>`;
  }).join("");
}
function scanStatusFor(pops) {
  return pops.length
    ? `${pops.length} from your list spotted here — tap one to collect it.`
    : SCAN_NO_POP;
}
function renderScanPops(pops) {
  // A new scan REPLACES the pops of the last one, wholesale.
  $("#scan-boxes").innerHTML = scanPopsHtml(pops);
  Q.scanPopsShown = pops.length > 0;
  $("#scan-status").textContent = scanStatusFor(pops);
}
function setScanLast(when) {
  $("#scan-last").textContent = when
    ? `${Q.scanMode === "live" ? "Live scan · " : ""}Last scan ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "";
}
function paintScanChrome() {
  const live = Q.scanMode === "live";
  $("#scan-stop").hidden = !live;
  $("#scan-usephoto").hidden = live;
  $("#scan-video").hidden = !live;
  $("#scan-img").hidden = live || !Q.scanUrl;
}
async function openScanView() {
  const sess = Q.current;
  if (!sess) return;
  qWalkStop(); // the player is standing at a shelf; the walk waits
  $("#scan-boxes").innerHTML = "";
  Q.scanPopsShown = false;
  setScanLast(null);
  $("#scan-status").textContent = "Starting the camera…";
  $("#scan-overlay").hidden = false;
  Q.scanMode = "starting";
  paintScanChrome();
  try {
    await startScanLive();
  } catch (e) {
    Q.scanMode = "still";
    paintScanChrome();
    $("#scan-status").textContent = "Camera not available here — take or choose a photo instead.";
  }
}
async function scanStill(file) {
  const sess = Q.current;
  if (!sess) return;
  Q.scanMode = "still";
  stopScanLive();
  if (Q.scanUrl) URL.revokeObjectURL(Q.scanUrl);
  Q.scanUrl = URL.createObjectURL(file);
  $("#scan-img").src = Q.scanUrl;
  paintScanChrome();
  $("#scan-boxes").innerHTML = "";
  Q.scanPopsShown = false;
  $("#scan-status").textContent = "Looking for your list on this shelf…";
  $("#scan-overlay").hidden = false;
  try {
    const out = await scanRequest(file, sess);
    if (Q.current !== sess || $("#scan-overlay").hidden) return;
    renderScanPops(out.pops || []);
    setScanLast(new Date());
  } catch (e) {
    $("#scan-status").textContent = "That scan didn't work — close and try again.";
  }
}
/* --- Live frame feed -----------------------------------------------
 * Sampling policy (unit-pinned): a downscaled frame diff runs on a
 * 250 ms tick. A frame is sent when the scene CHANGED materially
 * against the last sent frame (mean abs diff >= SCAN_DIFF) and then
 * HELD ~1 s (diffs against the previous frame under SCAN_SETTLE_EPS)
 * — settle sends are spaced by a floor of one per SCAN_FLOOR_MS.
 * If the scene never settles (continued change), a frame still goes
 * at a ceiling of one per SCAN_CEIL_MS. Pops from a stale frame
 * clear when the view has clearly moved on (diff >= SCAN_CLEAR,
 * sustained). One scan in flight at a time; the spacing clock runs
 * from the send, so a slow chain spaces the next frame out. */
const SCAN_TICK_MS = 250;
const SCAN_DIFF = 0.06;
const SCAN_SETTLE_EPS = 0.02;
const SCAN_HOLD_MS = 1000;
const SCAN_FLOOR_MS = 3000;
const SCAN_CEIL_MS = 2000;
const SCAN_CLEAR = 0.18;
function createScanSampler() {
  let lastSentAt = null, holdSince = null, clearStreak = 0, clearArmed = true;
  return {
    noteFrame(diffPrev, diffSent, now) {
      let clear = false;
      if (diffSent >= SCAN_CLEAR) {
        clearStreak++;
        if (clearStreak >= 2 && clearArmed) { clear = true; clearArmed = false; }
      } else { clearStreak = 0; clearArmed = true; }
      let send = false;
      if (diffSent >= SCAN_DIFF) {
        if (diffPrev < SCAN_SETTLE_EPS) {
          if (holdSince === null) holdSince = now;
        } else holdSince = null;
        const held = holdSince !== null && now - holdSince >= SCAN_HOLD_MS;
        if (held && (lastSentAt === null || now - lastSentAt >= SCAN_FLOOR_MS)) send = true;
        else if (!held && holdSince === null && diffPrev >= SCAN_DIFF &&
                 lastSentAt !== null && now - lastSentAt >= SCAN_CEIL_MS) send = true;
      } else holdSince = null;
      return { send, clear };
    },
    noteSent(now) { lastSentAt = now; holdSince = null; },
    reset() { lastSentAt = null; holdSince = null; clearStreak = 0; clearArmed = true; }
  };
}
async function startScanLive() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia) throw new Error("no camera");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }, audio: false
  });
  Q.scanStream = stream;
  const v = $("#scan-video");
  v.srcObject = stream;
  if (v.play) { try { await v.play(); } catch (e) { /* autoplay refusal: frames still read once playing */ } }
  Q.scanMode = "live";
  Q.sampler = createScanSampler();
  Q.scanPrevArr = null;
  Q.scanSentArr = null;
  Q.scanBusy = false;
  paintScanChrome();
  $("#scan-status").textContent = "Live scan — point the camera at a shelf.";
  Q.scanTimer = setInterval(scanTick, SCAN_TICK_MS);
  if (navigator.wakeLock) {
    try { Q.scanWake = await navigator.wakeLock.request("screen"); }
    catch (e) { Q.scanWake = null; }
  }
}
function stopScanLive() {
  if (Q.scanTimer) { clearInterval(Q.scanTimer); Q.scanTimer = null; }
  if (Q.scanStream) {
    Q.scanStream.getTracks().forEach(t => t.stop());
    Q.scanStream = null;
  }
  if (Q.scanWake) {
    const w = Q.scanWake;
    Q.scanWake = null;
    if (w.release) w.release().catch(() => {});
  }
  const v = $("#scan-video");
  if (v) v.srcObject = null;
  if (Q.scanMode === "live") Q.scanMode = "still";
  paintScanChrome();
}
document.addEventListener("visibilitychange", () => {
  // The platform drops the wake lock when the page hides; re-take
  // it when the live view comes back.
  if (typeof document !== "undefined" && document.visibilityState === "visible" &&
      Q.scanMode === "live" && !Q.scanWake &&
      typeof navigator !== "undefined" && navigator.wakeLock) {
    navigator.wakeLock.request("screen")
      .then(w => { Q.scanWake = w; }).catch(() => {});
  }
});
function scanFrameArray(video) {
  /* The tick's cheap eye: the frame downscaled to 48x36 luminance. */
  if (!Q.scanCanvas) Q.scanCanvas = document.createElement("canvas");
  const c = Q.scanCanvas;
  c.width = 48; c.height = 36;
  const ctx = c.getContext && c.getContext("2d");
  if (!ctx || !ctx.getImageData) return null;
  ctx.drawImage(video, 0, 0, 48, 36);
  const d = ctx.getImageData(0, 0, 48, 36).data;
  const arr = new Float32Array(48 * 36);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  }
  return arr;
}
function scanArrDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
function scanTick() {
  const sess = Q.current;
  if (!sess || Q.scanMode !== "live" || !Q.sampler) return;
  const v = $("#scan-video");
  if (!v || (v.readyState !== undefined && v.readyState < 2)) return;
  const arr = scanFrameArray(v);
  if (!arr) return;
  const diffPrev = Q.scanPrevArr ? scanArrDiff(arr, Q.scanPrevArr) : 0;
  const diffSent = Q.scanSentArr ? scanArrDiff(arr, Q.scanSentArr) : 1;
  Q.scanPrevArr = arr;
  const d = Q.sampler.noteFrame(diffPrev, diffSent, performance.now());
  if (d.clear && Q.scanPopsShown) {
    $("#scan-boxes").innerHTML = "";
    Q.scanPopsShown = false;
    $("#scan-status").textContent = "Live scan — looking…";
  }
  if (d.send && !Q.scanBusy) sendLiveFrame(v, arr, sess);
}
function sendLiveFrame(video, arr, sess) {
  Q.scanBusy = true;
  Q.sampler.noteSent(performance.now());
  const fail = () => {
    Q.scanBusy = false;
    if (Q.scanMode === "live" && !Q.scanPopsShown) {
      $("#scan-status").textContent = "That scan didn't work — still looking.";
    }
  };
  let c;
  try {
    c = document.createElement("canvas");
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
    c.width = Math.round((video.videoWidth || 1280) * scale);
    c.height = Math.round((video.videoHeight || 960) * scale);
    const ctx = c.getContext && c.getContext("2d");
    if (!ctx || !c.toBlob) { fail(); return; }
    ctx.drawImage(video, 0, 0, c.width, c.height);
  } catch (e) { fail(); return; }
  c.toBlob(async blob => {
    if (!blob) { fail(); return; }
    try {
      const out = await scanRequest(blob, sess);
      Q.scanBusy = false;
      if (Q.scanMode !== "live" || Q.current !== sess) return;
      Q.scanSentArr = arr;
      renderScanPops(out.pops || []);
      setScanLast(new Date());
    } catch (e) { fail(); }
  }, "image/jpeg", 0.85);
}
$("#scan-boxes").addEventListener("click", async ev => {
  const btn = ev.target.closest("[data-item]");
  const sess = Q.current;
  if (!btn || !sess || btn.classList.contains("got")) return;
  const name = btn.dataset.item;
  if (sess.state !== "playing") { toast("Start the hunt first."); return; }
  const cur = qCurrentIndex(sess);
  const isCurrent = cur >= 0 && sess.items[cur].name === name;
  const cIdx = sess.items.findIndex(i => i.name === name);
  btn.disabled = true;
  try {
    await qCheck(sess, name, true);
    qOnCollected(name); // celebration hook — same as the GRAB
    btn.classList.add("got");
    btn.querySelector(".poplabel").textContent = `${name} ✓`;
    Q.followHold = false;
    if (isCurrent) qRetarget(sess, cIdx); // a collect re-targets (Discussion 44)
    renderHunt();
    if (isCurrent) { qStepAnchorTo(name); qWalkStart(qCurrentIndex(sess)); }
    if (qNextIndex(sess) === -1) {
      closeScan();
      toast("All collected. Tap Finish when you're ready.");
    }
  } catch (e) { btn.disabled = false; toast(e.message); }
});
function closeScan() {
  stopScanLive(); // leaving the view releases the camera, always
  $("#scan-overlay").hidden = true;
  $("#scan-photo").value = "";
  const sess = Q.current;
  // Resume an interrupted walk, same rule as the pause button.
  if (sess && sess.state === "playing" && !Q.arrived && !Q.followHold &&
      qNextIndex(sess) >= 0 && !$("#view-hunt").hidden) {
    qWalkStart(qCurrentIndex(sess));
  }
}

/* ---------------- Express run ----------------
 * Hunt v2 item 9: no game chrome — a small strip view and the list
 * in walking order, where each row is the check. Any order; the
 * first tap starts the run. Checking the last row shows a toast and
 * never jumps to Finish. No celebration in this mode. */

function destroyExpScene() {
  if (Q.expScene) { Q.expScene.destroy(); Q.expScene = null; }
}
function openExpress(sess) {
  Q.current = sess;
  questShow("view-express");
  destroyExpScene();
  Q.expScene = createSceneView($("#exp-mount"), "strip");
  Q.expScene.onTapStop = idx => {
    const it = Q.current && Q.current.items[idx];
    if (it) qExpToggle(it);
  };
  Q.followHold = false;
  Q.mapNote = "";
  renderExpress();
  qWalkStart(qNextIndex(sess));
  qLoadStoreReports(sess.store).then(() => { if (Q.current === sess) renderExpress(); });
}
function renderExpress() {
  const sess = Q.current;
  if (!sess) return;
  const p = qProgress(sess);
  const next = qNextIndex(sess);
  if (Q.expScene) {
    Q.expScene.setStops(qStops(sess));
    Q.expScene.setNext(next);
  }
  $("#exp-store").textContent = `${sess.store} · ${QMODE_LABEL[sess.mode] || sess.mode}`;
  $("#exp-count").textContent = `${p.done}/${p.total}`;
  $("#exp-items").innerHTML = qExpListHtml(sess);
  $("#exp-rail").innerHTML = qRailHtml(sess.id);
  paintPauseBtn("#exp-pause", sess.state === "paused", sess.state === "not_started");
  $("#exp-finish").disabled = sess.state === "not_started";
}
async function qExpToggle(item) {
  const sess = Q.current;
  if (!sess || !item) return;
  try {
    if (sess.state === "not_started") await qSetState(sess, "playing");
    if (sess.state === "paused") { toast("The run is paused — resume first."); return; }
    const nextIdx = qNextIndex(sess);
    const wasNext = nextIdx >= 0 && sess.items[nextIdx].name === item.name;
    await qCheck(sess, item.name, !item.checked);
    renderExpress();
    if (item.checked && wasNext) {
      Q.followHold = false;
      qWalkStart(qNextIndex(sess));
    }
    if (qProgress(sess).left === 0) toast("All checked. Finish with the receipt.");
  } catch (e) { toast(e.message); }
}
$("#exp-items").addEventListener("click", ev => {
  const b = ev.target.closest("[data-exp-check]");
  if (!b || !Q.current) return;
  const item = Q.current.items.find(i => i.name === b.dataset.expCheck);
  if (item) qExpToggle(item);
});
$("#exp-pause").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try {
    const to = sess.state === "paused" ? "playing" : "paused";
    await qSetState(sess, to);
    if (to === "paused") qWalkStop();
    renderExpress();
    if (to === "playing" && !Q.arrived) qWalkStart(qNextIndex(sess));
  } catch (e) { toast(e.message); }
});
$("#exp-finish").addEventListener("click", () => {
  if (Q.current) openFinish(Q.current);
});

/* ---------------- Finish: the receipt settles it ----------------
 * Hunt v2 item 6: every way out of this screen — snap, sample,
 * skip — closes the hunt first, then lands on its Score. Back
 * returns to the live hunt, untouched. */

function qIsDemo() { return typeof isDemo !== "undefined" && !!isDemo; }
function qShowDemoDoors(root) {
  root.querySelectorAll(".demo-only").forEach(e => { e.hidden = !qIsDemo(); });
}
function openFinish(sess) {
  Q.current = sess;
  questShow("view-finish");
  const p = qProgress(sess);
  $("#fin-sub").textContent = (p.left === 0
    ? `Every item collected at ${sess.store}.`
    : `${p.done} of ${p.total} collected at ${sess.store}.`) +
    " The receipt is the scorecard — snap it and the hunt is settled.";
  $("#fin-status").textContent = "";
  $("#fin-photo").value = "";
  qShowDemoDoors($("#view-finish"));
}
async function qCloseHunt(sess) {
  if (sess.state === "playing" || sess.state === "paused" || sess.state === "not_started")
    await qSetState(sess, "finished");
}
async function qDecodeReceipt(file) {
  const r = await fetch("/decode/photo", {
    method: "POST",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return (await r.json()).receipt.receipt_id;
}
async function qAttach(sessionId, receiptId) {
  return post(`/api/quest/sessions/${sessionId}/receipt`, { receipt_id: receiptId });
}
async function qSample(sessionId) {
  return post(`/api/quest/sessions/${sessionId}/sample-receipt`, {});
}
async function closeToScore(sess, settle) {
  await qCloseHunt(sess);
  if (settle) Object.assign(sess, await settle());
  await qLoadSessions().catch(() => {});
  openScore(sess);
}
$("#fin-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  const sess = Q.current;
  if (!f || !sess) return;
  const status = $("#fin-status");
  status.textContent = "Reading the receipt — this can take up to a minute.";
  try {
    const rid = await qDecodeReceipt(f);
    status.textContent = "";
    await closeToScore(sess, () => qAttach(sess.id, rid));
  } catch (e) {
    status.textContent = "";
    toast("Could not file that photo: " + e.message);
  }
});
$("#fin-sample").addEventListener("click", async () => {
  const sess = Q.current, btn = $("#fin-sample");
  if (!sess) return;
  btn.disabled = true;
  try { await closeToScore(sess, () => qSample(sess.id)); }
  catch (e) { toast(e.message); }
  btn.disabled = false;
});
$("#fin-skip").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try { await closeToScore(sess, null); } catch (e) { toast(e.message); }
});

/* ---------------- Add receipt (wireframe 7b, as a sheet) ----------------
 * One job: attach this trip's receipt to a hunt that is already
 * finished. It never reopens the hunt; closing it leaves the player
 * on the screen that raised it (Score, Today, Receipts, Profile).
 * The app attaches the receipt — it does not compare the receipt's
 * lines to the collected items, so nothing here says "verified". */
let qAR = null;
function openAddReceipt(sessionId, label, onDone) {
  qAR = { sessionId, onDone };
  $("#ar-for").textContent = label ? `${label} · Finished · Receipt missing` : "";
  $("#ar-status").textContent = "";
  $("#ar-photo").value = "";
  qShowDemoDoors($("#ar-sheet"));
  $("#ar-sheet").hidden = false;
}
function closeAddReceipt() { $("#ar-sheet").hidden = true; qAR = null; }
async function qArSettle(settle) {
  if (!qAR) return;
  const { onDone } = qAR;
  const sess = await settle();
  closeAddReceipt();
  toast("Receipt attached — the hunt is settled.");
  await qLoadSessions().catch(() => {});
  if (onDone) onDone(sess);
}
$("#ar-close").addEventListener("click", closeAddReceipt);
$("#ar-sheet").addEventListener("click", ev => { if (ev.target.id === "ar-sheet") closeAddReceipt(); });
$("#ar-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f || !qAR) return;
  const sid = qAR.sessionId;
  const st = $("#ar-status");
  st.textContent = "Reading the receipt — this can take up to a minute.";
  try {
    const rid = await qDecodeReceipt(f);
    st.textContent = "";
    await qArSettle(() => qAttach(sid, rid));
  } catch (e) {
    st.textContent = "";
    toast("Could not file that photo: " + e.message);
  }
});
$("#ar-sample").addEventListener("click", async () => {
  if (!qAR) return;
  const sid = qAR.sessionId, btn = $("#ar-sample");
  btn.disabled = true;
  try { await qArSettle(() => qSample(sid)); } catch (e) { toast(e.message); }
  btn.disabled = false;
});

/* ---------------- Score ---------------- */

function qHuntDuration(sess, receipt) {
  if (!sess.started_at) return null;
  const endIso = (receipt && receipt.purchased_at) || sess.finished_at;
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(sess.started_at).getTime();
  return ms >= 0 ? ms : null;
}
/* Hunt v2 item 6: the Score is the closure. It leads with the hunt
 * being finished, says plainly whether its receipt is attached, and
 * offers Add receipt when it is not. */
async function openScore(sess) {
  Q.current = sess;
  questShow("view-score");
  const body = $("#score-body");
  body.innerHTML = `<div class="group">${empty("Scoring the hunt…")}</div>`;
  let receipt = null, profile = null;
  if (sess.receipt_id) {
    receipt = await api(`/api/quest/receipts/${encodeURIComponent(sess.receipt_id)}`).catch(() => null);
  }
  profile = await api("/api/quest/profile").catch(() => null);
  const p = qProgress(sess);
  const dur = qHuntDuration(sess, receipt);
  const attached = sess.state === "done";
  let html = `<div class="scorehero">
    <p class="hero-k">${attached ? "Receipt attached ✓" : "Finished · Receipt missing"}</p>
    <h2 class="largetitle" style="font-size:28px">${esc(sess.store)} — hunt finished</h2>
    <p class="muted nomargin">${QMODE_LABEL[sess.mode] || esc(sess.mode)} · ${p.done} of ${p.total} collected</p>
  </div><div class="group">`;
  html += row("Items found", "", `${p.done}/${p.total}`);
  if (dur != null) html += row("Time", receipt ? "hunt start to receipt" : "hunt start to finish", qDurText(dur));
  if (receipt) {
    html += row("Receipt",
      `${esc(receipt.merchant)} · ${receipt.items} items${receipt.returns_total ? ` · returns netted −${money(receipt.returns_total)}` : ""}`,
      money(receipt.total));
    if (!receipt.totals_reconcile) {
      html += `<p class="muted">The total did not reconcile — its lines are in your review queue.</p>`;
    }
  }
  html += `</div>`;
  html += `<p class="closenote">This hunt is closed. It has left Today — find it any time in Receipts.</p>`;
  if (!attached) {
    html += `<p class="muted">No receipt yet. Add this trip's receipt and the hunt is settled; until then it waits in Receipts as “Finished · Receipt missing”.</p>
      <p><button id="score-addreceipt" class="btn wide" type="button">Add the receipt ›</button></p>`;
  }
  if (profile) {
    const seen = new Set(JSON.parse(localStorage.getItem("arya-seen-badges") || "[]"));
    html += `<h3 class="sect">Badges</h3><div class="group">` + profile.badges.map((b, i) => {
      const isNew = b.earned && !seen.has(b.id);
      return `<div class="row${b.earned ? " badgepop" : ""}" style="animation-delay:${i * 90}ms">
        <div class="grow"><span class="name">${esc(b.name)}</span>
        <span class="sub">${esc(b.criteria)} · ${esc(b.detail)}</span></div>
        ${b.earned ? `<span class="money" style="color:var(--accent-text)">Earned</span>${isNew ? `<span class="newpill">New</span>` : ""}` : `<span class="sub">Locked</span>`}
      </div>`;
    }).join("") + `</div>`;
    localStorage.setItem("arya-seen-badges",
      JSON.stringify(profile.badges.filter(b => b.earned).map(b => b.id)));
  }
  body.innerHTML = html;
  const add = $("#score-addreceipt");
  if (add) add.addEventListener("click", () =>
    openAddReceipt(sess.id, sess.store, s => { Object.assign(sess, s); openScore(sess); }));
}
$("#score-done").addEventListener("click", () => {
  Q.stack = [];
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-home"; });
  stopHuntTimer();
  window.scrollTo(0, 0);
  refresh("view-home");
});

/* ---------------- Community ---------------- */

function qBadgeRows(badges) {
  return badges.map(b => `
    <div class="row">
      <div class="grow"><span class="name">${esc(b.name)}</span>
      <span class="sub">${esc(b.criteria)} · ${esc(b.detail)}</span></div>
      ${b.earned ? `<span class="money" style="color:var(--accent-text)">Earned</span>` : `<span class="sub">Locked</span>`}
    </div>`).join("");
}
function qFinishMs(sess) {
  if (!sess.started_at) return null;
  let endIso = sess.finished_at;
  if (sess.receipt_id) {
    // The photo finish: the receipt's own timestamp ends the hunt.
    const r = Q.receiptTimes && Q.receiptTimes[sess.receipt_id];
    if (r) endIso = r;
  }
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(sess.started_at).getTime();
  return ms > 0 ? ms : null;
}
async function renderCommunity() {
  questShow("view-community");
  const scope = document.querySelector("#comm-scopes .chip[aria-pressed='true']")?.dataset.scope || "household";
  const [profile, archive] = await Promise.all([
    api("/api/quest/profile").catch(() => null),
    api("/api/quest/receipts").catch(() => ({ receipts: [] }))
  ]);
  Q.receiptTimes = Object.fromEntries((archive.receipts || []).map(r => [r.receipt_id, r.purchased_at]));
  await qLoadSessions().catch(() => {});
  const board = $("#comm-board");
  if (scope !== "household") {
    board.innerHTML = empty("No hunts at this scope yet — boards widen as more hunters play.");
  } else {
    const rows = Q.sessions
      .filter(s => s.state === "done" && s.items.length >= 8)
      .map(s => ({ s, ms: qFinishMs(s) }))
      .filter(x => x.ms != null)
      .map(x => ({ ...x, per: x.ms / x.s.items.length }))
      .sort((a, b) => a.per - b.per);
    board.innerHTML = rows.length ? rows.map((x, i) => `
      <div class="row"><div class="grow"><span class="name">${i + 1}. ${esc(x.s.store)}</span>
      <span class="sub">${x.s.items.length} items · ${qDurText(x.ms)} · ${fmtShort(String(x.s.started_at).slice(0, 10))}</span></div>
      <div class="money">${Math.round(x.per / 1000)}s / item</div></div>`).join("")
      : empty("No qualifying hunts yet — finish a hunt with 8 or more items and a receipt.");
  }
  $("#comm-badges").innerHTML = profile ? qBadgeRows(profile.badges)
    : empty("Badges are unavailable right now.");
}
$("#comm-scopes").addEventListener("click", ev => {
  const b = ev.target.closest("[data-scope]");
  if (!b) return;
  document.querySelectorAll("#comm-scopes .chip").forEach(c =>
    c.setAttribute("aria-pressed", String(c === b)));
  renderCommunity().catch(showErr);
});

/* ---------------- Shop-Off ---------------- */

async function renderRace() {
  questShow("view-race");
  if (Q.racePrefill) {
    $("#race-opp").value = Q.racePrefill;
    Q.racePrefill = "";
  }
  await qLoadSessions().catch(() => {});
  const raceIds = [...new Set(Q.sessions.filter(s => s.shopoff_id).map(s => s.shopoff_id))];
  const body = $("#race-body");
  if (!raceIds.length) {
    body.innerHTML = `<div class="group">${empty("No races yet. Start one below, or challenge a friend.")}</div>`;
    return;
  }
  const races = await Promise.all(raceIds.map(id =>
    api(`/api/quest/shopoff/${encodeURIComponent(id)}`).catch(() => null)));
  body.innerHTML = races.filter(Boolean).map(race => `
    <div class="group pad">
      <p class="nomargin"><strong>${esc(race.store)}</strong> · ${race.state === "finished" ? "Finished" : "Racing"}</p>
      ${race.players.map(p => {
        const pct = p.progress && p.progress.total ? Math.round(p.progress.checked / p.progress.total * 100) : 0;
        return `<div class="row"><div class="grow"><span class="name">@${esc(p.handle)}${p.placeholder ? " (placeholder)" : ""}</span>
          <span class="track"><span class="bar" style="width:${pct}%"></span></span>
          <span class="sub">${p.progress ? `${p.progress.checked}/${p.progress.total} collected` : ""}${p.done && p.finish_time ? ` · receipt ${esc(String(p.finish_time).replace("T", " "))}` : ""}</span></div>
          <button class="chip" data-open-sess="${esc(p.session_id)}" type="button">Open</button></div>`;
      }).join("")}
      ${race.state === "finished"
        ? `<p class="nomargin" style="margin-top:8px"><strong>${race.winner ? `Winner: @${esc(race.winner)} — by receipt time.` : "Dead heat — identical receipt times."}</strong></p>`
        : `<p class="muted nomargin" style="margin-top:8px">First verified receipt wins.</p>`}
    </div>`).join("");
}
$("#race-body").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-open-sess]");
  if (!b) return;
  await qLoadSessions().catch(() => {});
  const s = qSessionById(b.dataset.openSess);
  if (s) qOpenSession(s);
});
$("#race-create").addEventListener("click", async () => {
  const opp = $("#race-opp").value.trim().replace(/^@/, "");
  const store = $("#race-store").value.trim();
  const items = qParseLines($("#race-items").value);
  if (!opp) { toast("Name your opponent's handle."); return; }
  if (!store) { toast("Name the store."); return; }
  if (!items.length) { toast("The race needs a list."); return; }
  const btn = $("#race-create");
  btn.disabled = true;
  try {
    await post("/api/quest/shopoff", { store, items, opponent_handle: opp });
    toast("Race on. Both hunts are on Today.");
    renderRace().catch(showErr);
  } catch (e) { toast(e.message); }
  btn.disabled = false;
});

/* ---------------- Friends ---------------- */

async function renderFriends() {
  questShow("view-friends");
  const d = await api("/api/quest/friends");
  const el = $("#fr-list");
  if (!d.friends.length) {
    el.innerHTML = empty("No friends yet. Add one by handle.");
    return;
  }
  el.innerHTML = d.friends.map(f => {
    if (f.status === "pending_in") {
      return `<div class="row"><div class="grow"><span class="name">@${esc(f.handle)}</span>
        <span class="sub">Wants to hunt with you</span></div>
        <button class="chip" data-accept="${esc(f.handle)}" type="button">Accept</button></div>`;
    }
    if (f.status === "pending_out") {
      return `<div class="row"><div class="grow"><span class="name">@${esc(f.handle)}</span>
        <span class="sub">Request sent</span></div></div>`;
    }
    return `<div class="row"><div class="grow"><span class="name">@${esc(f.handle)}</span>
      <span class="sub">${f.top_badge ? `Top badge: ${esc(f.top_badge)}` : "No badges yet"}${f.last_hunt ? ` · Last hunt: ${esc(f.last_hunt)}` : " · No hunts yet"}</span></div>
      <button class="chip" data-challenge="${esc(f.handle)}" type="button">Challenge</button></div>`;
  }).join("");
}
$("#fr-list").addEventListener("click", async ev => {
  const acc = ev.target.closest("[data-accept]");
  if (acc) {
    try {
      await post("/api/quest/friends/accept", { handle: acc.dataset.accept });
      toast("Friends. Their boards and badges are yours to chase.");
      renderFriends().catch(showErr);
    } catch (e) { toast(e.message); }
    return;
  }
  const ch = ev.target.closest("[data-challenge]");
  if (ch) {
    Q.racePrefill = ch.dataset.challenge;
    questGo("view-race");
  }
});
$("#fr-add").addEventListener("click", async () => {
  const handle = $("#fr-handle").value.trim();
  if (!handle) { toast("Type a handle first."); return; }
  try {
    const f = await post("/api/quest/friends", { handle });
    toast(f.status === "accepted" ? `@${f.handle} is already your friend.` : `Request sent to @${f.handle}.`);
    $("#fr-handle").value = "";
    renderFriends().catch(showErr);
  } catch (e) { toast(e.message); }
});

/* ---------------- Receipt archive ---------------- */

function qSigned(n) {
  return n != null && n < 0 ? `<span class="return">−${money(n)}</span>` : (n != null ? money(n) : "");
}
$("#rcd-back").addEventListener("click", ev => {
  ev.preventDefault(); show("view-receipts"); refresh("view-receipts");
});
async function openReceipt(receiptId) {
  const r = await api(`/api/quest/receipts/${encodeURIComponent(receiptId)}`);
  questShow("view-receipt");
  const lines = r.lines.map(ln => {
    if (ln.line_type === "return") {
      return row(esc(ln.name), "Returned", qSigned(ln.line_total));
    }
    if (ln.line_type === "discount") {
      return row(esc(ln.name), "Savings on the item above", qSigned(ln.line_total));
    }
    return row(`${esc(ln.name)}${ln.qty > 1 ? ` × ${qtyFmt(ln.qty)}` : ""}`,
               ln.status === "unverified" ? "Unverified — in your review queue" : "",
               ln.line_total != null ? money(ln.line_total) : "");
  }).join("");
  $("#rc-body").innerHTML = `
    <h2 class="largetitle" style="font-size:28px">${esc(r.merchant)}</h2>
    <p class="subtitle">${esc(String(r.purchased_at).replace("T", " "))} · filed from ${esc(r.source_type || "a receipt")}</p>
    <div class="group">${lines || empty("No lines on this receipt.")}</div>
    <div class="group">
      ${r.subtotal != null ? row("Subtotal", "", money(r.subtotal)) : ""}
      ${r.tax != null ? row("Tax", "", money(r.tax)) : ""}
      ${row("Total", "", money(r.total))}
      ${r.returns_total ? row("Returns netted", "", `<span class="return">−${money(r.returns_total)}</span>`) : ""}
    </div>
    <p class="muted">${r.totals_reconcile
      ? `Total verified ✓ — the lines add up to ${money(r.total)}.`
      : "The total did not reconcile — unverified lines wait in your review queue."}</p>
    ${r.photo ? `<p class="nomargin">${String(r.media_type || "").startsWith("image/")
      ? `<button class="btn" id="rc-view-btn" type="button">View receipt</button>
         <img id="rc-view-img" class="receiptimg" src="/api/quest/receipts/${encodeURIComponent(r.receipt_id)}/original" alt="The filed receipt photo" hidden>`
      : `<a class="btn" href="/api/quest/receipts/${encodeURIComponent(r.receipt_id)}/original" target="_blank" rel="noopener">View receipt</a>`}</p>` : ""}`;
  const viewBtn = $("#rc-view-btn");
  if (viewBtn) viewBtn.addEventListener("click", () => {
    const img = $("#rc-view-img");
    img.hidden = !img.hidden;
  });
}
