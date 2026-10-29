"use strict";
/* Map my store, shown as "Teach Arya your store" (owner,
 * 2026-10-28: the shopper teaches the app so it can help them). A guided mapper: the app says
 * exactly what to capture, the engine (api/storemap.py) keeps the
 * best frames. A shopper maps only the aisles they use, over many
 * visits; every shopper's captures merge into one shared map.
 *
 * Two kinds of capture, both prompted: a PHOTO of one shelf, or a
 * WALK past one aisle. Either way the camera stays open and the app
 * watches the frames itself: it guides with a live hint and keeps
 * the best frame, so nobody is ever told to retake (owner rule).
 * A walk never uploads video; it sends the sharpest frame of each
 * section, and its length decides how many sections the aisle has. State lives on the server; this file keeps
 * only the screen's selection. */
const M = {
  store: "",
  view: null,        // last GET /api/storemap
  side: "both",
  prompt: null,      // the capture on screen
  busy: false,
};
const M_STATUS = {
  unmapped: ["New to Arya", "st-none"],
  mapped: ["Mapped", "st-ok"],
  aging: ["Getting old", "st-age"],
  stale: ["Out of date", "st-stale"],
};
const M_WALK_SAMPLES = 12;   // frames looked at in a walk video
const M_WALK_SEND = 6;       // sharpest frames sent

function mapperStoreName() {
  if (M.store) return M.store;
  const fav = (Q.mine || []).find(s => s.favorite) || (Q.mine || [])[0];
  return fav ? fav.name : "";
}

async function renderMapper() {
  try { await qLoadMine(); } catch (e) { Q.mine = Q.mine || []; }
  M.store = mapperStoreName();
  const names = [...new Set((Q.mine || []).map(s => s.name))];
  if (M.store && !names.includes(M.store)) names.unshift(M.store);
  $("#mp-stores").innerHTML = names.map(n =>
    `<button class="chip" data-mstore="${esc(n)}" aria-pressed="${String(n === M.store)}" type="button">${esc(n)}</button>`).join("");
  if (!M.store) {
    $("#mp-cover").innerHTML = empty("Pick a store from My Stores first.");
    $("#mp-walk").innerHTML = ""; $("#mp-next").innerHTML = ""; $("#mp-segs").innerHTML = "";
    return;
  }
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  paintMapper();
}

function paintMapper() {
  const v = M.view;
  $("#mp-walk").innerHTML = `<div class="group pad mp-nextcard">
       <span class="eyebrow">Zero typing</span>
       <div class="name">Walk your store</div>
       <p class="muted">Just walk the aisles you shop, phone up. Arya reads the shelves, names each section, and builds the map. Afterwards you check what it found — that's all.</p>
       <button class="btn primary wide" id="mp-walkstart" type="button">Start the walk</button>
     </div>`;
  const done = v.counts.mapped;
  $("#mp-cover").innerHTML = v.total
    ? `<div class="mp-count">Arya knows <strong>${v.coverage_pct}%</strong> of ${esc(v.store || M.store)} <span class="muted">· ${done} of ${v.total} sections</span></div>
       <div class="track" aria-hidden="true"><span class="bar" style="width:${v.coverage_pct}%"></span></div>
       <p class="muted nomargin">${v.counts.aging ? `${v.counts.aging} getting old. ` : ""}${v.counts.stale ? `${v.counts.stale} reported out of date. ` : ""}${v.counts.unmapped ? `${v.counts.unmapped} still new to Arya. ` : ""}Teach the aisles you use. You never need all of them.</p>
       ${mapperGoalHtml(v)}`
    : `<p class="nomargin">No aisles here yet. Walk the store and Arya builds the map from what it sees.</p>`;
  const p = v.next;
  $("#mp-next").innerHTML = p
    ? `<div class="group pad mp-nextcard">
         <span class="eyebrow">Teach Arya next</span>
         <div class="name">${esc(p.title)}</div>
         <p class="muted">${esc(p.why)}</p>
         <button class="btn primary wide" id="mp-start" type="button">Open camera · about ${p.est_seconds} s</button>
       </div>`
    : (v.total ? `<div class="group pad"><p class="nomargin">Arya knows every aisle you picked. Your hunts here use real shelf photos now.</p></div>` : "");
  const focus = new Set(v.focus || M.focus || []);
  $("#mp-segs").innerHTML = v.segments.length
    ? v.segments.map(s => {
        const [label, cls] = M_STATUS[s.status];
        const sub = [s.side === "both" ? "both sides" : s.side + " side",
          s.contributors > 1 ? `${s.contributors} shoppers` : "",
          s.stale_item ? `${s.stale_item} not found` : ""].filter(Boolean).join(" · ");
        return `<div class="row mp-seg">
          <button class="mp-mine ${focus.has(s.id) ? "on" : ""}" data-mfocus="${esc(s.id)}" aria-pressed="${String(focus.has(s.id))}" aria-label="${focus.has(s.id) ? "Remove from my aisles" : "Add to my aisles"}" type="button">${focus.has(s.id) ? "Mine" : "+"}</button>
          <button class="grow mp-open" data-mseg="${esc(s.id)}" type="button"><span class="name">${esc(s.label)}</span><span class="sub">${esc(sub)}</span></button>
          <span class="mp-st ${cls}">${label}</span></div>`;
      }).join("")
    : empty("Nothing mapped yet.");
}

function mapperGoalHtml(v) {
  const c = v.credit || {};
  const goal = v.goal
    ? `${v.goal.sections_needed} more section${v.goal.sections_needed === 1 ? "" : "s"} and Arya knows ${v.goal.pct}%`
    : "Arya knows this whole store.";
  return `<div class="mp-me"><span class="muted">${esc(goal)}</span>${c.title
    ? `<span><strong>${esc(c.title)}</strong> · ${c.points} pts</span>` : ""}</div>`;
}

/* "My aisles": the shopper's own focus. Tapping + / Mine moves the
 * aisle in or out; the next capture then comes from there first. */
async function mapperToggleFocus(id) {
  const cur = new Set(M.view.focus || []);
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  const out = await post("/api/storemap/focus", { store: M.store, segments: [...cur] });
  M.view.focus = out.focus;
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  M.view.focus = out.focus;
  paintMapper();
}

document.addEventListener("click", ev => {
  const st = ev.target.closest("[data-mstore]");
  if (st) { M.store = st.dataset.mstore; renderMapper().catch(showErr); return; }
  const f = ev.target.closest("[data-mfocus]");
  if (f) { mapperToggleFocus(f.dataset.mfocus).catch(e => toast(e.message)); return; }
  const o = ev.target.closest("[data-mseg]");
  if (o) { mapperOpenSegment(o.dataset.mseg).catch(e => toast(e.message)); return; }
  const side = ev.target.closest("#mp-side [data-side]");
  if (side) {
    M.side = side.dataset.side;
    document.querySelectorAll("#mp-side [data-side]").forEach(b =>
      b.setAttribute("aria-pressed", String(b === side)));
  }
});
$("#btn-map-store").addEventListener("click", () => questGo("view-mapper"));
$("#mp-next").addEventListener("click", ev => {
  if (ev.target.closest("#mp-start") && M.view.next) openCapture(M.view.next);
});
$("#mp-add").addEventListener("click", async () => {
  const label = $("#mp-label").value.trim();
  if (!label) { toast("Name the aisle first."); return; }
  try {
    const out = await post("/api/storemap/segments", { store: M.store, label, side: M.side });
    $("#mp-label").value = "";
    toast(out.created ? "Added. Open the camera to teach it." : "Arya already has that aisle.");
    await renderMapper();
  } catch (e) { toast(e.message); }
});

async function mapperOpenSegment(id) {
  const out = await api(`/api/storemap/next?store=${encodeURIComponent(M.store)}&segment=${encodeURIComponent(id)}`);
  if (out.prompt) openCapture(out.prompt);
}

/* ---------------- guided capture ----------------
 * Owner rule: no retake loops. The shopper opens the camera; the app
 * watches every frame, shows one live hint, and keeps the best frame
 * on its own. The server never refuses a shot either: a weak one is
 * kept as a partial and the engine asks again on a later visit. */

const CAM = { stream: null, timer: null, walk: null };
const CAM_TICK_MS = 250;
const PHOTO_SETTLE_MS = 1500;   // steady this long, then snap
const PHOTO_MAX_MS = 6000;      // snap the best seen by then anyway
const WALK_BUCKET_MS = 2000;    // keep the sharpest frame per 2 s
const WALK_SECONDS_PER_PART = 8;
const WALK_MAX_MS = 45000;

function openCapture(prompt) {
  camStop();
  M.prompt = prompt;
  $("#cp-title").textContent = prompt.title;
  $("#cp-why").textContent = prompt.why || "";
  $("#cp-steps").innerHTML = (prompt.steps || []).map(t => `<li>${esc(t)}</li>`).join("");
  $("#cp-time").textContent = `About ${prompt.est_seconds || 10} seconds.`;
  $("#cp-go").textContent = "Open camera";
  $("#cp-go").disabled = false;
  $("#cp-howto").hidden = false;
  $("#cp-cam").hidden = true;
  $("#cp-controls").hidden = false;
  $("#cp-result").hidden = true;
  $("#cp-after").hidden = true;
  $("#cp-outdated").hidden = !prompt.segment;
  $("#cp-photo").value = ""; $("#cp-video").value = "";
  questShow("view-capture");
  if (!prompt.segment && !prompt.teach) mapperPickAisle();
}

/* Zero-entry teach (owner, 2026-10-28): the walk IS the form. The
 * shopper walks; the server reads each frame's section and builds
 * the map; the confirm card at the end is the only "input" — and
 * it is check-and-remove, never typing. */
function openTeachWalk() {
  openCapture({ kind: "walk", segment: "", teach: true, est_seconds: 30,
    title: `Walk ${M.store}`,
    why: "Just walk the aisles you shop. Arya reads the shelves and builds the map — nothing to type, no aisles to name.",
    steps: ["Hold the phone upright at chest height, shelves in view.",
            "Walk slowly, the way you shop.",
            "Pass the aisles you use. Skip the rest — other shoppers fill them in.",
            "Tap Done at the end. Arya names each section it saw, and you check them."] });
}
$("#mp-walk").addEventListener("click", ev => {
  if (ev.target.closest("#mp-walkstart")) openTeachWalk();
});

/* A "not found" report asks for one specific photo. Offered as a
 * one-tap on the report toast; nothing is forced. */
function mapperOffer(store, task) {
  if (!task || !task.prompt) return;
  M.store = store;
  toast("Show Arya the shelf? It learns where things moved.", {
    action: "Open camera",
    onAction: () => {
      api(`/api/storemap?store=${encodeURIComponent(store)}`)
        .then(v => { M.view = v; openCapture(task.prompt); })
        .catch(() => openCapture(task.prompt));
    }
  });
}

/* "Can't find it" with a photo already attached: that photo teaches
 * the map directly, in the background. No screen, no retake. */
async function mapperQuietCapture(store, segment, file) {
  M.store = store;
  try {
    const out = await mapperUpload(file, "photo", segment);
    toast(out.reward && out.reward.new_section
      ? `Reported, and Arya learned this shelf. +${out.reward.points}`
      : "Reported, and Arya's map of this shelf is fresh again.");
  } catch (e) {
    toast("Reported — other hunters will confirm.");
  }
}

/* We do not know which aisle a missing item lives in yet: one tap on
 * the aisle you are standing in, then the camera. */
function mapperPickAisle() {
  const segs = ((M.view && M.view.segments) || []);
  $("#cp-controls").hidden = true;
  mapperShowResult(segs.length
    ? `<p class="nomargin">Tap the aisle you are in:</p><div class="rail">${segs.map(s =>
        `<button class="chip" data-mpick="${esc(s.id)}" type="button">${esc(s.label)}</button>`).join("")}</div>`
    : `<p class="nomargin">Arya does not know this store's aisles yet. Add the one you are in from Teach Arya your store.</p>`);
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-mpick]");
  if (b) mapperOpenSegment(b.dataset.mpick).catch(e => toast(e.message));
});

function mapperShowResult(html) {
  const box = $("#cp-result");
  box.innerHTML = html; box.hidden = false;
}

async function mapperUpload(blob, kind, segment) {
  const q = `store=${encodeURIComponent(M.store)}&segment=${encodeURIComponent(segment || M.prompt.segment)}&kind=${kind}`;
  const r = await fetch(`/api/storemap/capture?${q}`, {
    method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

/* ---- frame grading on the phone (no network, no model) ---- */
function mapperSharpness(canvas) {
  const w = 160, h = Math.max(1, Math.round(canvas.height * 160 / canvas.width));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let luma = 0;
  for (let i = 0; i < w * h; i++) { g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; luma += g[i]; }
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const l = -4 * g[y * w + x] + g[y * w + x - 1] + g[y * w + x + 1] + g[(y - 1) * w + x] + g[(y + 1) * w + x];
    sum += l; sq += l * l; n++;
  }
  return { sharp: sq / n - (sum / n) * (sum / n), luma: luma / (w * h) };
}
/* One line of live guidance. `rel` is this frame's sharpness over the
 * best seen so far, so "hold still" means "you were steadier a moment
 * ago", whatever the phone's camera. */
function camHint(g, rel, walk) {
  if (g.luma < 45) return ["A bit dark. Face the shelf light.", false];
  if (g.luma > 225) return ["Tilt a little to lose the glare.", false];
  if (rel < 0.5) return [walk ? "A little slower…" : "Hold still…", false];
  return [walk ? "Nice and steady. Keep walking." : "Good. Holding…", true];
}
function camGrab(video) {
  const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
  const c = document.createElement("canvas");
  c.width = Math.round((video.videoWidth || 1280) * scale);
  c.height = Math.round((video.videoHeight || 960) * scale);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return c;
}
const camBlob = c => new Promise(res => c.toBlob(res, "image/jpeg", 0.88));

async function camStart() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return false;
  try {
    CAM.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
  } catch (e) { return false; }
  const v = $("#cp-live");
  v.srcObject = CAM.stream;
  await v.play().catch(() => {});
  $("#cp-cam").hidden = false;
  $("#cp-howto").hidden = true;
  return true;
}
function camStop() {
  clearInterval(CAM.timer); CAM.timer = null;
  if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop());
  CAM.stream = null;
  const v = $("#cp-live"); if (v) v.srcObject = null;
}

$("#cp-go").addEventListener("click", async () => {
  if (M.busy) return;
  if (CAM.walk) { camFinishWalk(); return; }      // the button is "Done" mid-walk
  const walk = M.prompt.kind === "walk";
  if (!(await camStart())) {
    // No live camera (old browser, permission denied): fall back to
    // the system camera. Still no retakes: we use what comes back.
    $(walk ? "#cp-video" : "#cp-photo").click();
    return;
  }
  if (walk) camWalk(); else camPhoto();
});

/* PHOTO: watch, hint, and snap the best frame once it has been
 * steady for a moment (or after a few seconds, whatever we have). */
function camPhoto() {
  const v = $("#cp-live"), hint = $("#cp-hint");
  $("#cp-go").textContent = "Snapping when steady…";
  $("#cp-go").disabled = true;
  $("#cp-parts").innerHTML = "";
  const t0 = Date.now();
  let best = null, maxSharp = 1, goodSince = 0;
  CAM.timer = setInterval(async () => {
    if (!v.videoWidth) return;
    const c = camGrab(v), g = mapperSharpness(c);
    maxSharp = Math.max(maxSharp, g.sharp);
    const [text, ok] = camHint(g, g.sharp / maxSharp, false);
    hint.textContent = text; hint.classList.toggle("good", ok);
    const score = g.sharp * (ok ? 1 : 0.5);
    if (!best || score > best.score) best = { c, score };
    goodSince = ok ? (goodSince || Date.now()) : 0;
    const now = Date.now();
    if ((goodSince && now - goodSince >= PHOTO_SETTLE_MS) || now - t0 >= PHOTO_MAX_MS) {
      clearInterval(CAM.timer); CAM.timer = null;
      hint.textContent = "Got it ✓"; hint.classList.add("good");
      const blob = await camBlob(best.c);
      camStop();
      await mapperSend([{ blob, segment: M.prompt.segment }], "photo");
    }
  }, CAM_TICK_MS);
}

/* WALK: record nothing; keep the sharpest frame of every 2 seconds.
 * Its length says how long the aisle is: about 8 s of walking per
 * section, so a long aisle splits itself into front/middle/back. */
function camWalk() {
  const v = $("#cp-live"), hint = $("#cp-hint");
  const go = $("#cp-go");
  go.textContent = "Done"; go.disabled = false;
  CAM.walk = { t0: Date.now(), buckets: [], maxSharp: 1 };
  const parts = (M.prompt.parts || [M.prompt.segment]).length;
  CAM.walk.shownParts = parts;
  $("#cp-parts").innerHTML = "<span></span>".repeat(parts);
  CAM.timer = setInterval(() => {
    const w = CAM.walk;
    if (!w || !v.videoWidth) return;
    const el = Date.now() - w.t0;
    const c = camGrab(v), g = mapperSharpness(c);
    w.maxSharp = Math.max(w.maxSharp, g.sharp);
    const [text, ok] = camHint(g, g.sharp / w.maxSharp, true);
    hint.textContent = text; hint.classList.toggle("good", ok);
    const b = Math.floor(el / WALK_BUCKET_MS);
    const score = g.sharp * (ok ? 1 : 0.5);
    if (!w.buckets[b] || score > w.buckets[b].score) w.buckets[b] = { c, score };
    // Grow the section bar as the aisle turns out longer.
    const want = M.prompt.splittable ? Math.max(1, Math.min(6, Math.round(el / 1000 / WALK_SECONDS_PER_PART))) : parts;
    if (want !== w.shownParts) { w.shownParts = want; $("#cp-parts").innerHTML = "<span></span>".repeat(want); }
    const done = Math.min(want, Math.floor(el / 1000 / WALK_SECONDS_PER_PART) + 1);
    $("#cp-parts").querySelectorAll("span").forEach((s, i) => s.classList.toggle("on", i < done));
    if (el >= WALK_MAX_MS) camFinishWalk();
  }, CAM_TICK_MS * 2);
}

async function camFinishWalk() {
  const w = CAM.walk; CAM.walk = null;
  if (!w) return;
  const secs = (Date.now() - w.t0) / 1000;
  camStop();
  const frames = [];
  for (const b of w.buckets.filter(Boolean)) frames.push({ blob: await camBlob(b.c), score: b.score });
  if (M.prompt && M.prompt.teach) { await mapperTeachSend(teachPicks(frames)); return; }
  await mapperSendWalk(frames, secs);
}

/* A teach walk sends a spread of its sharpest frames — one read
 * per frame, and the server merges repeats of the same section. */
function teachPicks(frames) {
  if (frames.length <= M_WALK_SEND) return frames.map(f => f.blob);
  const step = frames.length / M_WALK_SEND;
  const out = [];
  for (let i = 0; i < M_WALK_SEND; i++) out.push(frames[Math.floor(i * step)].blob);
  return out;
}

async function mapperTeachUpload(blob) {
  const q = `store=${encodeURIComponent(M.store)}&kind=walk`;
  const r = await fetch(`/api/storemap/teach?${q}`, {
    method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

/* Send the walk's frames to the teach reader, then show the
 * confirm card: the sections Arya found, each removable with one
 * tap while it is still only the teacher's. Unreadable frames are
 * skipped quietly — a walk never fails over one bad frame. */
async function mapperTeachSend(blobs) {
  M.busy = true;
  $("#cp-controls").hidden = true;
  $("#cp-cam").hidden = true;
  mapperShowResult(`<p class="nomargin">Reading the shelves and building the map…</p>`);
  const found = new Map();
  let pts = 0, newTitle = null;
  for (const blob of blobs) {
    try {
      const out = await mapperTeachUpload(blob);
      const cur = found.get(out.segment) || { label: out.label, segment: out.segment, created: out.created, fresh: false };
      if (out.reward) {
        pts += out.reward.points;
        if (out.reward.new_section) cur.fresh = true;
        if (out.reward.new_title) newTitle = out.reward.new_title;
      }
      found.set(out.segment, cur);
    } catch (e) { /* skip the frame; nothing was kept for it */ }
  }
  M.busy = false;
  if (!found.size) { mapperGentle(); await mapperAfter(); return; }
  const rows = [...found.values()].map(f =>
    `<div class="row mp-seg"><span class="grow"><span class="name">${esc(f.label)}</span><span class="sub">${f.created ? "new section" : "already on the map"}</span></span><button class="btn small" data-tdiscard="${esc(f.segment)}" type="button">Not a section ✕</button></div>`).join("");
  mapperShowResult(`<div class="mp-reward">
    <div class="what">Arya found ${found.size} section${found.size === 1 ? "" : "s"}</div>
    <p class="muted">Check them — a wrong one comes straight back out. Everything here came from your walk. You typed nothing.</p>
    ${rows}
    ${pts ? `<div class="pts">+${pts}</div>` : ""}
    ${newTitle ? `<div class="mp-title">You're now a ${esc(newTitle)}</div>` : ""}
  </div>`);
  if ([...found.values()].some(f => f.fresh) && window.qConfetti) qConfetti();
  await mapperAfter();
}

document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-tdiscard]");
  if (!b) return;
  try {
    const out = await post("/api/storemap/discard", { store: M.store, segment: b.dataset.tdiscard });
    const row = b.closest(".mp-seg"); if (row) row.remove();
    toast(`${out.label} taken back off the map.`);
    M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  } catch (e) { toast(e.message); }
});

/* Spread a walk's frames, in time order, over the aisle's sections
 * and send the sharpest frame of each section. */
async function mapperSendWalk(frames, secs) {
  if (!frames.length) { mapperGentle(); return; }
  let ids = M.prompt.parts || [M.prompt.segment];
  const want = Math.max(1, Math.min(6, Math.round(secs / WALK_SECONDS_PER_PART)));
  if (M.prompt.splittable && want >= 2) {
    try {
      const out = await post("/api/storemap/split", { store: M.store, segment: M.prompt.segment, parts: want });
      ids = out.segments.map(s => s.id);
    } catch (e) { /* keep the whole aisle as one piece */ }
  }
  const picks = ids.map((id, k) => {
    const lo = Math.floor(k * frames.length / ids.length);
    const hi = Math.max(lo + 1, Math.floor((k + 1) * frames.length / ids.length));
    const group = frames.slice(lo, hi);
    if (!group.length) return null;
    return { blob: group.reduce((a, b) => (b.score > a.score ? b : a)).blob, segment: id };
  }).filter(Boolean);
  await mapperSend(picks, "walk");
}

/* Upload, then celebrate. A failure never asks for a retake: the
 * engine simply asks for this part again on a later visit. */
async function mapperSend(picks, kind) {
  M.busy = true;
  $("#cp-controls").hidden = true;
  $("#cp-cam").hidden = true;
  mapperShowResult(`<p class="nomargin">Blurring any people and adding it to the map…</p>`);
  const won = [];
  let last = null;
  for (const p of picks) {
    try {
      const out = await mapperUpload(p.blob, kind, p.segment);
      if (out.reward) { won.push({ out, seg: p.segment }); last = out.reward; }
    } catch (e) { /* skip quietly; nothing was kept for this one */ }
  }
  M.busy = false;
  if (!won.length) { mapperGentle(); await mapperAfter(); return; }
  mapperShowResult(mapperRewardHtml(won, last));
  if (won.some(w => w.out.reward.new_section) && window.qConfetti) qConfetti();
  requestAnimationFrame(() => {
    const bar = document.querySelector("#cp-result .bar");
    if (bar) bar.style.width = `${last.store_pct[1]}%`;
  });
  await mapperAfter();
}

function mapperGentle() {
  mapperShowResult(`<p class="nomargin"><strong>Thanks!</strong> We could not save this one just now, so nothing was kept. No need to redo it. We will ask again another time.</p>`);
}

function mapperSegLabel(id) {
  const s = ((M.view && M.view.segments) || []).find(x => x.id === id);
  return s ? s.label : (M.prompt && M.prompt.title) || "This aisle";
}

function mapperRewardHtml(won, last) {
  const pts = won.reduce((n, w) => n + w.out.reward.points, 0);
  const fresh = won.filter(w => w.out.reward.new_section);
  const partial = won.some(w => w.out.weak);
  const what = fresh.length > 1 ? `Arya learned ${fresh.length} sections`
    : fresh.length ? `Arya learned ${esc(mapperSegLabel(fresh[0].seg))}`
    : "Arya's picture of this shelf is fresh again";
  const [a, b] = last.store_pct;
  const goal = last.goal ? `${last.goal.sections_needed} more section${last.goal.sections_needed === 1 ? "" : "s"} to ${last.goal.pct}%` : "Arya knows the whole store!";
  return `<div class="mp-reward">
    <div class="pts">+${pts}</div>
    <div class="what">${what}</div>
    <div class="muted">Arya knows ${a}% → <strong>${b}%</strong> of this store</div>
    <div class="track" aria-hidden="true"><span class="bar" style="width:${a}%"></span></div>
    <div class="muted">${esc(goal)}</div>
    ${last.new_title ? `<div class="mp-title">You're now a ${esc(last.new_title)}</div>` : ""}
    ${fresh.length ? `<p class="muted">Next hunt here, this aisle shows a real shelf photo, so you spot things faster.</p>` : ""}
    ${partial ? `<p class="muted">Some of it was a little soft. That is fine; it still helps, and a later shopper will sharpen it.</p>` : ""}
  </div>`;
}

async function mapperAfter() {
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  $("#cp-after").hidden = false;
  $("#cp-next").textContent = M.view.next ? "Teach one more · about 20 s" : "Back to the map";
}

/* Fallbacks when the live camera is not available. Same rules. */
$("#cp-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f || M.busy) return;
  await mapperSend([{ blob: f, segment: M.prompt.segment }], "photo");
});
function mapperSeek(video, t) {
  return new Promise(res => { video.onseeked = () => res(); video.currentTime = t; });
}
async function mapperVideoFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.src = url;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error("Could not read that video.")); });
  const dur = video.duration || 1;
  const n = Math.max(4, Math.min(24, Math.round(dur / (WALK_BUCKET_MS / 1000))));
  const frames = [];
  for (let i = 0; i < n; i++) {
    await mapperSeek(video, dur * (i + 0.5) / n);
    const c = camGrab(video);
    frames.push({ blob: await camBlob(c), score: mapperSharpness(c).sharp });
  }
  URL.revokeObjectURL(url);
  return { frames, secs: dur };
}
$("#cp-video").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f || M.busy) return;
  mapperShowResult("Picking the sharpest frames from your walk…");
  try {
    const { frames, secs } = await mapperVideoFrames(f);
    if (M.prompt && M.prompt.teach) await mapperTeachSend(teachPicks(frames));
    else await mapperSendWalk(frames, secs);
  } catch (e) { mapperGentle(); }
});

$("#cp-next").addEventListener("click", () => {
  if (M.view && M.view.next) openCapture(M.view.next);
  else questGo("view-mapper");
});
$("#cp-outdated").addEventListener("click", async () => {
  if (!M.prompt || !M.prompt.segment) return;
  try {
    const out = await post("/api/storemap/outdated", { store: M.store, segment: M.prompt.segment });
    toast("Thanks. Marked out of date.");
    if (out.prompt) openCapture(out.prompt);
  } catch (e) { toast(e.message); }
});
/* Leaving the capture screen always turns the camera off. */
document.addEventListener("click", ev => {
  if (ev.target.closest("#view-capture .qback")) { CAM.walk = null; camStop(); }
});

/* ---------------- the teach ask: briefing + in-hunt icon ----------
 * (Owner, 2026-10-28: moved OFF the score screen.) One ask, two
 * surfaces: a skippable card on the pre-hunt briefing (shown only
 * once the player has finished a hunt before — never before the
 * first), and a passive Teach Arya tool button during the hunt
 * itself, where the player is standing in the aisle. "Not now"
 * mutes the store for a week across both surfaces. Never a popup;
 * Express gets neither surface. The engine picks the aisle (one
 * where something on this list was found comes first). */
const MAP_MUTE_DAYS = 7;
function mapperMuted(store) {
  try {
    const m = JSON.parse(localStorage.getItem("arya-map-mute") || "{}");
    return m[store] && Date.now() - m[store] < MAP_MUTE_DAYS * 864e5;
  } catch (e) { return false; }
}
function mapperMute(store) {
  try {
    const m = JSON.parse(localStorage.getItem("arya-map-mute") || "{}");
    m[store] = Date.now();
    localStorage.setItem("arya-map-mute", JSON.stringify(m));
  } catch (e) { /* private mode: the ask just returns next time */ }
}
async function mapperNextPrompt(store, items) {
  try {
    const out = await api(`/api/storemap/next?store=${encodeURIComponent(store)}&items=${encodeURIComponent((items || []).join(","))}`);
    const p = out && out.prompt;
    return p && p.segment ? p : null;
  } catch (e) { return null; }
}
function mapperOfferCard(sess, host, p) {
  if (!host || host.querySelector(".mp-offer")) return;
  const where = p.title.replace(/^(Photo of|Walk)\s+/, "");
  const card = document.createElement("div");
  card.className = "group pad mp-offer";
  card.innerHTML = `<span class="eyebrow">Bonus · +10 pts</span>
    <div class="name">Got ${p.est_seconds} seconds? Teach Arya ${esc(where)}.</div>
    <p class="muted nomargin">Your next hunt here gets faster. Open the camera and walk; Arya does the rest.</p>
    <div class="rail"><button class="btn primary" data-mapoffer="go" type="button">Teach Arya</button>
    <button class="btn" data-mapoffer="later" type="button">Not now</button></div>`;
  host.prepend(card);
  card.addEventListener("click", ev => {
    const b = ev.target.closest("[data-mapoffer]");
    if (!b) return;
    if (b.dataset.mapoffer === "later") { mapperMute(sess.store); card.remove(); return; }
    M.store = sess.store;
    api(`/api/storemap?store=${encodeURIComponent(M.store)}`).then(v => { M.view = v; }).catch(() => {});
    openCapture(p);
  });
}
/* The briefing card: before the hunt starts, at the store door —
 * the player is about to walk the aisles anyway. */
async function mapperOfferBriefing(sess) {
  if (!sess || !sess.store || sess.mode === "express" || mapperMuted(sess.store)) return;
  let hunted = false;
  try { hunted = !!localStorage.getItem("arya-hunted"); } catch (e) {}
  if (!hunted) return;
  const host = $("#q-brief");
  if (!host || $("#view-hunt").hidden) return;
  if (host.dataset.store === sess.store && host.querySelector(".mp-offer")) return;
  host.dataset.store = sess.store;
  const items = (sess.items || []).map(i => i.name).slice(0, 30);
  const p = await mapperNextPrompt(sess.store, items);
  if (p) mapperOfferCard(sess, host, p);
}
/* Teach Arya from Express's More help: the same capture as the Quest
 * tool button, for the aisle the engine picks. A store with nothing
 * left to teach says so. */
async function mapperTeachNow(sess) {
  if (!sess || !sess.store) return;
  const items = (sess.items || []).filter(i => !i.checked).map(i => i.name).slice(0, 30);
  const p = await mapperNextPrompt(sess.store, items);
  if (!p) { toast("Arya already knows every aisle of this store."); return; }
  M.store = sess.store;
  api(`/api/storemap?store=${encodeURIComponent(M.store)}`).then(v => { M.view = v; }).catch(() => {});
  openCapture(p);
}
window.mapperTeachNow = mapperTeachNow;
/* The in-hunt icon: a passive tool button, present only while the
 * store still has an aisle to teach. Tapping opens the capture for
 * the engine's picked aisle; the hunt waits (it lives server-side). */
let MAP_ICON = { store: null, prompt: undefined };
async function mapperHuntIcon(sess) {
  const btn = $("#btn-teach");
  if (!btn) return;
  const live = sess && sess.state === "playing" && sess.mode !== "express" && !mapperMuted(sess.store);
  if (!live) { btn.hidden = true; return; }
  if (MAP_ICON.store !== sess.store) MAP_ICON = { store: sess.store, prompt: undefined };
  if (MAP_ICON.prompt === undefined) {
    MAP_ICON.prompt = null;
    const items = (sess.items || []).filter(i => !i.checked).map(i => i.name).slice(0, 30);
    MAP_ICON.prompt = await mapperNextPrompt(sess.store, items);
  }
  btn.hidden = !MAP_ICON.prompt;
  btn.onclick = () => {
    if (!MAP_ICON.prompt) return;
    M.store = sess.store;
    api(`/api/storemap?store=${encodeURIComponent(M.store)}`).then(v => { M.view = v; }).catch(() => {});
    openCapture(MAP_ICON.prompt);
  };
}
