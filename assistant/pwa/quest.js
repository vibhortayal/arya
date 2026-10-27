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
  // The SceneView ladder: strip is the default (a store with no model
  // still plays in full); the player can switch rungs mid-hunt and
  // loses nothing — session state lives here, never in a driver.
  driverName: localStorage.getItem("arya-scene-driver") || "strip",
};

function stopHuntTimer() {
  if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
}

/* ---------------- navigation ---------------- */

function questShow(id) {
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== id; });
  if (id !== "view-hunt") stopHuntTimer();
  if (Q.stack[Q.stack.length - 1] !== id) Q.stack.push(id);
  window.scrollTo(0, 0);
}
function questBack() {
  Q.stack.pop();
  const prev = Q.stack[Q.stack.length - 1];
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== (prev || "view-home"); });
  if (prev !== "view-hunt") stopHuntTimer();
  window.scrollTo(0, 0);
}
document.addEventListener("click", ev => {
  const back = ev.target.closest(".qback");
  if (back) { ev.preventDefault(); questBack(); return; }
  const nav = ev.target.closest("[data-qnav]");
  if (nav) { questGo(nav.dataset.qnav); }
});
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => { Q.stack = []; stopHuntTimer(); }));

function questGo(id) {
  if (id === "view-community") renderCommunity().catch(showErr);
  if (id === "view-race") renderRace().catch(showErr);
  if (id === "view-friends") renderFriends().catch(showErr);
  if (id === "view-qprofile") renderQProfile().catch(showErr);
  questShow(id);
}

/* ---------------- shared helpers ---------------- */

function qnorm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function qProgress(sess) {
  const total = sess.items.length;
  const done = sess.items.filter(i => i.checked).length;
  return { done, total, left: total - done };
}
const QSTATE_LABEL = { not_started: "Not started", playing: "Playing", paused: "Paused", finished: "Finished — add the receipt", done: "Done" };
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
  if (sess.state === "done") { openScore(sess); return; }
  if (sess.state === "finished") { openFinish(sess); return; }
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

async function renderQuestHub() {
  const box = $("#quest-sessions");
  if (!box) return;
  await qLoadSessions().catch(() => { Q.sessions = []; });
  if (!Q.sessions.length) {
    box.innerHTML = `<div class="group">${empty("No hunts yet today. Start one — the list becomes the game.")}</div>`;
    return;
  }
  box.innerHTML = `<div class="group">` + Q.sessions.map(s => {
    const p = qProgress(s);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const who = s.placeholder ? ` · @${esc(s.owner_handle || "opponent")}&rsquo;s hunt (Shop-Off)` : "";
    return `<button class="sessrow" data-sess="${esc(s.id)}" type="button">
      <span class="grow"><span class="name">${esc(s.store)}</span>
      <span class="sub">${QMODE_LABEL[s.mode] || s.mode} · ${QSTATE_LABEL[s.state] || s.state}${who}</span>
      <span class="track"><span class="bar" style="width:${pct}%"></span></span></span>
      <span class="money">${p.done}/${p.total}</span>
    </button>`;
  }).join("") + `</div>`;
}
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
  // Store chips: stores this account already shops (sessions + spend).
  const stores = new Set(Q.sessions.map(s => s.store));
  try {
    const d = await api("/api/dashboard");
    Object.keys(d.spend_by_store || {}).forEach(s => stores.add(s));
  } catch (e) { /* chips are a shortcut, not a requirement */ }
  $("#st-chips").innerHTML = [...stores].map(s =>
    `<button class="chip" data-store="${esc(s)}" type="button">${esc(s)}</button>`).join("");
  questShow("view-store");
});
$("#st-chips").addEventListener("click", ev => {
  const b = ev.target.closest("[data-store]");
  if (b) $("#st-name").value = b.dataset.store;
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
        { store: Q.draft.store, mode, items: Q.draft.finalItems, driver: Q.driverName });
      await qLoadSessions().catch(() => {});
      toast(`${QMODE_LABEL[mode]} at ${sess.store} — ready when you are.`);
      qOpenSession(sess);
    } catch (e) { toast(e.message); }
    b.disabled = false;
  }));

/* ---------------- Hunt (Quest mode) ---------------- */

function qNextIndex(sess) {
  return sess.items.findIndex(i => !i.checked);
}
function qStops(sess) {
  const flagged = new Set(Q.storeReports.map(r => r.item_group || qnorm(r.item)));
  return sess.items.map(i => ({
    name: i.name, qty: i.qty, checked: i.checked,
    flagged: flagged.has(i.group) || flagged.has(qnorm(i.name))
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
  document.querySelectorAll("#scene-toggle [data-driver]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.driver === Q.driverName)));
}
function mountScene() {
  const mount = $("#scene-mount");
  if (Q.scene) Q.scene.destroy();
  Q.scene = createSceneView(mount, Q.driverName);
  Q.scene.onTapStop = idx => {
    if (idx === qNextIndex(Q.current)) collectCurrent();
  };
  paintSceneToggle();
}
$("#scene-toggle").addEventListener("click", ev => {
  const b = ev.target.closest("[data-driver]");
  if (!b || b.dataset.driver === Q.driverName) return;
  // Drop a rung (or climb one) mid-hunt: the driver is only a view —
  // stops, checks, and the clock live in the session, untouched.
  Q.driverName = b.dataset.driver;
  localStorage.setItem("arya-scene-driver", Q.driverName);
  mountScene();
  renderHunt();
});
function openHunt(sess) {
  Q.current = sess;
  questShow("view-hunt");
  $("#hunt-rail").innerHTML = qRailHtml(sess.id);
  mountScene();
  $("#hunt-mapnote").textContent =
    `No 3D model for ${sess.store} yet — map this store to unlock the 3D view. The hunt plays the same either way.`;
  renderHunt();
  qLoadStoreReports(sess.store).then(() => { if (Q.current === sess) renderHunt(); });
}
function renderHunt() {
  const sess = Q.current;
  if (!sess) return;
  const p = qProgress(sess);
  $("#hunt-store").textContent = sess.store;
  $("#hunt-progress").textContent =
    `${QMODE_LABEL[sess.mode]} · ${QSTATE_LABEL[sess.state]} · ${p.done} of ${p.total} collected`;
  const next = qNextIndex(sess);
  if (Q.scene) {
    Q.scene.setStops(qStops(sess));
    Q.scene.setNext(next);
  }
  const banner = $("#hunt-next");
  if (sess.state === "not_started") {
    banner.innerHTML = `<p class="nomargin"><strong>Ready when you are.</strong></p>
      <p class="muted nomargin">${p.total} items. The first one glows in the aisle.</p>`;
  } else if (next === -1) {
    banner.innerHTML = `<p class="nomargin"><strong>Everything collected.</strong></p>
      <p class="muted nomargin">Finish with the receipt to settle the hunt.</p>`;
  } else {
    const it = sess.items[next];
    const rep = Q.storeReports.find(r => (r.item_group && r.item_group === it.group) || qnorm(r.item) === qnorm(it.name));
    banner.innerHTML = `<p class="nomargin"><span class="sub">Next</span><strong>${esc(it.name)}</strong>${it.qty > 1 ? ` · × ${qtyFmt(it.qty)}` : ""}</p>
      ${rep ? `<p class="warn nomargin">Reported missing — another hunter could not find it here.</p>` : ""}`;
  }
  const btn = $("#btn-collect");
  if (sess.state === "not_started") { btn.textContent = "Start the hunt"; btn.disabled = false; }
  else if (next === -1) { btn.textContent = "Collect"; btn.disabled = true; }
  else { btn.textContent = `Collect · ${sess.items[next].name}`; btn.disabled = sess.state !== "playing"; }
  $("#btn-pause").textContent = sess.state === "paused" ? "Resume" : "Pause";
  $("#btn-pause").disabled = sess.state === "not_started";
  $("#btn-finish").disabled = sess.state === "not_started";
  $("#list-left").textContent = p.left;
  startHuntTimer(sess);
}
async function collectCurrent() {
  const sess = Q.current;
  const next = qNextIndex(sess);
  if (!sess || next === -1 || sess.state !== "playing") return;
  const name = sess.items[next].name;
  try {
    await qCheck(sess, name, true);
    if (Q.scene) Q.scene.glideTo(qNextIndex(sess));
    renderHunt();
    if (qNextIndex(sess) === -1) {
      toast("List complete. Finish with the receipt.");
      openFinish(sess);
    }
  } catch (e) { toast(e.message); }
}
$("#btn-collect").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  if (sess.state === "not_started") {
    try { await qSetState(sess, "playing"); renderHunt(); }
    catch (e) { toast(e.message); }
    return;
  }
  collectCurrent();
});
$("#btn-pause").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try {
    await qSetState(sess, sess.state === "paused" ? "playing" : "paused");
    renderHunt();
  } catch (e) { toast(e.message); }
});
$("#btn-finish").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try {
    if (sess.state === "playing" || sess.state === "paused") await qSetState(sess, "finished");
    openFinish(sess);
  } catch (e) { toast(e.message); }
});

/* The list panel: summoned over the hunt, never a page. */
function renderPanel() {
  const sess = Q.current;
  $("#panel-items").innerHTML = sess.items.map(i => `
    <div class="row listrow${i.checked ? " checked" : ""}">
      <button class="check" data-panel-check="${esc(i.name)}" aria-label="Check off ${esc(i.name)}">${CHECK_SVG}</button>
      <div class="grow"><span class="name">${esc(i.name)}</span></div>
      <div class="money">× ${qtyFmt(i.qty)}</div>
    </div>`).join("") || empty("The list is empty.");
}
let panelTimer = null;
function openPanel() { renderPanel(); $("#list-panel").hidden = false; }
function closePanel() { $("#list-panel").hidden = true; clearTimeout(panelTimer); }
$("#btn-listpanel").addEventListener("click", openPanel);
$("#panel-close").addEventListener("click", closePanel);
$("#list-panel").addEventListener("click", ev => { if (ev.target.id === "list-panel") closePanel(); });
$("#panel-items").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-panel-check]");
  if (!b || !Q.current) return;
  const item = Q.current.items.find(i => i.name === b.dataset.panelCheck);
  if (!item) return;
  try {
    await qCheck(Q.current, item.name, !item.checked);
    renderPanel();
    renderHunt();
    // After a check the panel slides away on its own — the game is home.
    clearTimeout(panelTimer);
    panelTimer = setTimeout(closePanel, 650);
  } catch (e) { toast(e.message); }
});

/* ---------------- Express run ---------------- */

function openExpress(sess) {
  Q.current = sess;
  questShow("view-express");
  $("#exp-rail").innerHTML = qRailHtml(sess.id);
  renderExpress();
  qLoadStoreReports(sess.store).then(() => { if (Q.current === sess) renderExpress(); });
}
function renderExpress() {
  const sess = Q.current;
  if (!sess) return;
  const p = qProgress(sess);
  $("#exp-store").textContent = sess.store;
  $("#exp-progress").textContent =
    `${QMODE_LABEL[sess.mode]} · ${QSTATE_LABEL[sess.state]} · ${p.done} of ${p.total} checked`;
  $("#exp-startwrap").hidden = sess.state !== "not_started";
  const eta = $("#exp-eta");
  if (p.left === 0 && p.total > 0) eta.textContent = "Done";
  else eta.textContent = `≈ ${p.left * 2 + 2} min left`;
  const flagged = new Set(Q.storeReports.map(r => r.item_group || qnorm(r.item)));
  $("#exp-items").innerHTML = sess.items.map(i => `
    <div class="row listrow${i.checked ? " checked" : ""}">
      <button class="check" data-exp-check="${esc(i.name)}" aria-label="Check off ${esc(i.name)}">${CHECK_SVG}</button>
      <div class="grow"><span class="name">${esc(i.name)}</span>
      ${(flagged.has(i.group) || flagged.has(qnorm(i.name))) ? `<span class="sub warn">Reported missing at this store.</span>` : ""}</div>
      <div class="money">× ${qtyFmt(i.qty)}</div>
    </div>`).join("") || empty("The list is empty.");
  $("#exp-pause").textContent = sess.state === "paused" ? "Resume" : "Pause";
  $("#exp-pause").disabled = sess.state === "not_started";
  $("#exp-finish").disabled = sess.state === "not_started";
}
$("#exp-start").addEventListener("click", async () => {
  if (!Q.current) return;
  try { await qSetState(Q.current, "playing"); renderExpress(); }
  catch (e) { toast(e.message); }
});
$("#exp-items").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-exp-check]");
  if (!b || !Q.current) return;
  const sess = Q.current;
  const item = sess.items.find(i => i.name === b.dataset.expCheck);
  if (!item) return;
  try {
    if (sess.state === "not_started") await qSetState(sess, "playing");
    if (sess.state === "paused") { toast("The run is paused — resume first."); return; }
    await qCheck(sess, item.name, !item.checked);
    renderExpress();
    if (qProgress(sess).left === 0) toast("All checked. Finish with the receipt.");
  } catch (e) { toast(e.message); }
});
$("#exp-pause").addEventListener("click", async () => {
  if (!Q.current) return;
  try {
    await qSetState(Q.current, Q.current.state === "paused" ? "playing" : "paused");
    renderExpress();
  } catch (e) { toast(e.message); }
});
$("#exp-finish").addEventListener("click", async () => {
  const sess = Q.current;
  if (!sess) return;
  try {
    if (sess.state === "playing" || sess.state === "paused") await qSetState(sess, "finished");
    openFinish(sess);
  } catch (e) { toast(e.message); }
});

/* ---------------- Finish: the receipt settles it ---------------- */

function openFinish(sess) {
  Q.current = sess;
  questShow("view-finish");
  $("#fin-status").textContent = "";
  $("#fin-photo").value = "";
  renderFinishReceipts().catch(showErr);
}
async function renderFinishReceipts() {
  const d = await api("/api/quest/receipts");
  const el = $("#fin-receipts");
  el.innerHTML = d.receipts.length ? d.receipts.slice(0, 8).map(r => `
    <button class="sessrow" data-attach="${esc(r.receipt_id)}" type="button">
      <span class="grow"><span class="name">${esc(r.merchant)}</span>
      <span class="sub">${fmtShort(String(r.purchased_at).slice(0, 10))} · ${r.items} items</span></span>
      <span class="money">${r.total != null ? money(r.total) : ""}</span>
    </button>`).join("") : empty("No receipts filed yet.");
}
async function attachAndScore(receiptId) {
  const sess = Q.current;
  const s = await post(`/api/quest/sessions/${sess.id}/receipt`, { receipt_id: receiptId });
  Object.assign(sess, s);
  await qLoadSessions().catch(() => {});
  openScore(sess);
}
$("#fin-receipts").addEventListener("click", async ev => {
  const b = ev.target.closest("[data-attach]");
  if (!b) return;
  try { await attachAndScore(b.dataset.attach); }
  catch (e) { toast(e.message); }
});
$("#fin-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  const status = $("#fin-status");
  status.textContent = "Reading the receipt…";
  try {
    const r = await fetch("/decode/photo", {
      method: "POST",
      headers: { "Content-Type": f.type || "image/jpeg" },
      body: f
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
    const out = await r.json();
    status.textContent = "";
    await attachAndScore(out.receipt.receipt_id);
  } catch (e) {
    status.textContent = "";
    toast("Could not file that photo: " + e.message);
  }
});
$("#fin-skip").addEventListener("click", () => { if (Q.current) openScore(Q.current); });

/* ---------------- Score ---------------- */

function qHuntDuration(sess, receipt) {
  if (!sess.started_at) return null;
  const endIso = (receipt && receipt.purchased_at) || sess.finished_at;
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(sess.started_at).getTime();
  return ms >= 0 ? ms : null;
}
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
  let html = `<div class="group">`;
  html += row(esc(sess.store), `${QMODE_LABEL[sess.mode]} · ${QSTATE_LABEL[sess.state]}`,
              `${p.done}/${p.total}`);
  if (dur != null) html += row("Time", receipt ? "hunt start to receipt" : "hunt start to finish", qDurText(dur));
  if (receipt) {
    html += row("Verified haul",
      `${esc(receipt.merchant)} · ${receipt.items} items${receipt.returns_total ? ` · returns netted −${money(receipt.returns_total)}` : ""}`,
      receipt.totals_reconcile ? `✓ ${money(receipt.total)}` : money(receipt.total));
    if (!receipt.totals_reconcile) {
      html += `<p class="muted">The total did not reconcile — its lines are in your review queue.</p>`;
    }
  } else {
    html += `<p class="muted">No receipt attached — this hunt is not scored yet. Attach one from the session card and the haul verifies.</p>`;
  }
  html += `</div>`;
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
}
$("#score-done").addEventListener("click", () => {
  Q.stack = [];
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-home"; });
  stopHuntTimer();
  window.scrollTo(0, 0);
  refresh("view-home");
});
