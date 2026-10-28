"use strict";
/* Map my store (owner, 2026-10-28). A guided mapper: the app says
 * exactly what to capture, the engine (api/storemap.py) keeps the
 * best frames. A shopper maps only the aisles they use, over many
 * visits; every shopper's captures merge into one shared map.
 *
 * Two kinds of capture, both prompted: a PHOTO of one shelf, or a
 * WALK (a short video past one aisle). A walk never uploads the
 * video: the phone picks the sharpest few frames and sends those
 * as photos, so each one goes through the same people scrub and
 * the same grading. State lives on the server; this file keeps
 * only the screen's selection. */
const M = {
  store: "",
  view: null,        // last GET /api/storemap
  side: "both",
  prompt: null,      // the capture on screen
  busy: false,
};
const M_STATUS = {
  unmapped: ["Not mapped", "st-none"],
  mapped: ["Mapped", "st-ok"],
  aging: ["Getting old", "st-age"],
  stale: ["Out of date", "st-stale"],
};

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
    $("#mp-next").innerHTML = ""; $("#mp-segs").innerHTML = "";
    return;
  }
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  paintMapper();
}

function paintMapper() {
  const v = M.view;
  const done = v.counts.mapped;
  $("#mp-cover").innerHTML = v.total
    ? `<div class="mp-count"><strong>${done} of ${v.total}</strong> aisles mapped and fresh</div>
       <div class="track" aria-hidden="true"><span class="bar" style="width:${v.coverage_pct}%"></span></div>
       <p class="muted nomargin">${v.counts.aging ? `${v.counts.aging} getting old. ` : ""}${v.counts.stale ? `${v.counts.stale} reported out of date. ` : ""}${v.counts.unmapped ? `${v.counts.unmapped} not mapped yet. ` : ""}You do not need to map everything.</p>`
    : `<p class="nomargin">No aisles here yet. Add the aisle you shop in, below.</p>`;
  const p = v.next;
  $("#mp-next").innerHTML = p
    ? `<div class="group pad mp-nextcard">
         <span class="eyebrow">Next capture</span>
         <div class="name">${esc(p.title)}</div>
         <p class="muted">${esc(p.why)}</p>
         <button class="btn primary wide" id="mp-start" type="button">${p.kind === "walk" ? "Start the walk" : "Start"} · about ${p.est_seconds} s</button>
       </div>`
    : (v.total ? `<div class="group pad"><p class="nomargin">Everything you picked is mapped. Thank you.</p></div>` : "");
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
    toast(out.created ? "Added. Tap Start to map it." : "That aisle is already on the map.");
    await renderMapper();
  } catch (e) { toast(e.message); }
});

async function mapperOpenSegment(id) {
  const out = await api(`/api/storemap/next?store=${encodeURIComponent(M.store)}&segment=${encodeURIComponent(id)}`);
  if (out.prompt) openCapture(out.prompt);
}

/* ---------------- guided capture ----------------
 * No shutter button, no verdicts, no retakes. The camera opens, the
 * app watches the live view, tells the shopper what it needs in one
 * short line ("Slow down", "More light", "Good, keep going"), and
 * quietly sends the good frames. Grading happens on the phone
 * before upload, and anything the server still declines is dropped
 * without a word. The screen finishes on its own. */
const MC = {
  stream: null, timer: null, wake: null, queue: [], sending: false,
  prevThumb: null, lastSentThumb: null, lastSentAt: 0, steadySince: 0,
  accepted: 0, target: 0, started: 0, kind: "photo", done: false,
  gen: 0,
};
const MC_TICK_MS = 600;
const MC_MIN_SHARP = 60;        // laplacian variance at 480 px wide
const MC_MIN_LUMA = 55, MC_MAX_LUMA = 215;
const MC_GIVE_UP_MS = 30000;
const MC_WALK_GAP_MS = 1500;

function openCapture(prompt) {
  mcStop();
  M.prompt = prompt;
  $("#cp-title").textContent = prompt.title;
  $("#cp-why").textContent = prompt.why || "";
  $("#cp-steps").innerHTML = (prompt.steps || []).map(t => `<li>${esc(t)}</li>`).join("");
  $("#cp-hint").textContent = "Starting the camera…";
  $("#cp-dots").innerHTML = "";
  $("#cp-fallback").hidden = true;
  $("#cp-video-wrap").hidden = false;
  $("#cp-outdated").hidden = !prompt.segment;
  questShow("view-capture");
  mcStart(prompt).catch(() => mcFallback());
}

function mcDots() {
  $("#cp-dots").innerHTML = Array.from({ length: MC.target }, (_, i) =>
    `<span class="mc-dot${i < MC.accepted ? " on" : ""}"></span>`).join("");
}

async function mcStart(prompt) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera");
  const gen = ++MC.gen;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
  if (gen !== MC.gen) { stream.getTracks().forEach(t => t.stop()); return; }
  MC.stream = stream;
  const v = $("#cp-video");
  v.srcObject = stream;
  if (v.play) { try { await v.play(); } catch (e) { /* frames still read once playing */ } }
  Object.assign(MC, { queue: [], sending: false, prevThumb: null, lastSentThumb: null,
    lastSentAt: 0, steadySince: 0, accepted: 0, done: false, started: Date.now(),
    kind: prompt.kind, target: prompt.kind === "walk" ? 6 : 1 });
  mcDots();
  $("#cp-hint").textContent = prompt.kind === "walk" ? "Start walking slowly." : "Hold still on the shelf.";
  MC.timer = setInterval(mcTick, MC_TICK_MS);
  if (navigator.wakeLock) {
    try { MC.wake = await navigator.wakeLock.request("screen"); } catch (e) { MC.wake = null; }
  }
}

function mcStop() {
  MC.gen++;
  if (MC.timer) { clearInterval(MC.timer); MC.timer = null; }
  if (MC.stream) { MC.stream.getTracks().forEach(t => t.stop()); MC.stream = null; }
  if (MC.wake) { const w = MC.wake; MC.wake = null; if (w.release) w.release().catch(() => {}); }
}

/* The camera is not available (a desktop, a refusal): the phone's
 * own camera app takes one photo. Whatever the server decides, the
 * shopper is thanked once and never asked to retake. */
function mcFallback() {
  mcStop();
  $("#cp-video-wrap").hidden = true;
  $("#cp-fallback").hidden = false;
  $("#cp-hint").textContent = "";
}
$("#cp-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  $("#cp-hint").textContent = "Thanks. Checking it…";
  try {
    const out = await mapperUpload(f, "photo");
    $("#cp-hint").textContent = out.accepted
      ? "Saved. Thank you."
      : "Thanks. This one was not clear enough to use, so the map keeps what it has.";
    await mapperAfter();
    mcFinishSoon();
  } catch (e) { $("#cp-hint").textContent = "Thanks. We could not send that one."; }
});

function mcThumb(video) {
  const c = mcThumb.c || (mcThumb.c = document.createElement("canvas"));
  c.width = 32; c.height = 18;
  c.getContext("2d").drawImage(video, 0, 0, 32, 18);
  const d = c.getContext("2d").getImageData(0, 0, 32, 18).data;
  const a = new Float32Array(32 * 18);
  for (let i = 0; i < a.length; i++) a[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  return a;
}
function mcDiff(a, b) {
  if (!a || !b) return 255;
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
function mcFrameBlob(video, maxSide) {
  const w = video.videoWidth, h = video.videoHeight;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return c;
}
function mcLuma(canvas) {
  const c = document.createElement("canvas"); c.width = 48; c.height = 27;
  const ctx = c.getContext("2d"); ctx.drawImage(canvas, 0, 0, 48, 27);
  const d = ctx.getImageData(0, 0, 48, 27).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  return s / (d.length / 4);
}

function mcTick() {
  const v = $("#cp-video");
  if (MC.done || !v.videoWidth) return;
  const now = Date.now();
  const small = mcFrameBlob(v, 480);
  const sharp = mapperSharpness(small);
  const luma = mcLuma(small);
  const thumb = mcThumb(v);
  const moving = mcDiff(thumb, MC.prevThumb) > 14;
  MC.prevThumb = thumb;
  let hint, good = false;
  if (luma < MC_MIN_LUMA) hint = "A little dark. Face the shelf light.";
  else if (luma > MC_MAX_LUMA) hint = "Too much glare. Tilt the phone a little.";
  else if (sharp < MC_MIN_SHARP) hint = MC.kind === "walk" ? "Slow down a little." : "Hold still for a second.";
  else { good = true; hint = MC.kind === "walk" ? "Good. Keep walking slowly." : "Good. Hold still."; }
  if (good && MC.kind === "photo") {
    if (!MC.steadySince || moving) MC.steadySince = now;
    good = now - MC.steadySince >= 800;
  }
  const spaced = now - MC.lastSentAt >= (MC.kind === "walk" ? MC_WALK_GAP_MS : 2500);
  const fresh = mcDiff(thumb, MC.lastSentThumb) > (MC.kind === "walk" ? 20 : 6);
  if (good && spaced && fresh && MC.queue.length < 2 && MC.accepted + MC.queue.length < MC.target) {
    MC.lastSentAt = now; MC.lastSentThumb = thumb;
    const full = mcFrameBlob(v, 960);
    full.toBlob(b => { MC.queue.push(b); mcPump(); }, "image/jpeg", 0.85);
  }
  if (MC.accepted < MC.target) $("#cp-hint").textContent = hint;
  if (now - MC.started > MC_GIVE_UP_MS && MC.accepted < MC.target && !MC.queue.length && !MC.sending) {
    // Not a failure, not a retake: the shopper is thanked and the
    // map keeps what it has. Whatever was kept still counts.
    mcFinish(MC.accepted ? "Thanks. That helps." : "No worries. Try again another time.");
  }
}

async function mcPump() {
  if (MC.sending || !MC.queue.length) return;
  MC.sending = true;
  const gen = MC.gen;
  const blob = MC.queue.shift();
  try {
    const out = await mapperUpload(blob, MC.kind === "walk" ? "walk" : "photo");
    if (gen === MC.gen && out.accepted) { MC.accepted++; mcDots(); }
  } catch (e) { /* silent: the next good frame goes up instead */ }
  MC.sending = false;
  if (gen !== MC.gen) return;
  if (MC.accepted >= MC.target) mcFinish("Mapped. Thank you.");
  else mcPump();
}

async function mcFinish(msg) {
  if (MC.done) return;
  MC.done = true;
  mcStop();
  $("#cp-hint").textContent = msg;
  try { await mapperAfter(); } catch (e) { /* the map screen reloads anyway */ }
  mcFinishSoon();
}
/* After a capture the app moves on by itself: the next capture the
 * engine wants, or the map when nothing is left. "Done for today"
 * is always one tap away. */
function mcFinishSoon() {
  const gen = ++MC.gen;
  setTimeout(() => {
    if (gen !== MC.gen) return;
    if (M.view && M.view.next) openCapture(M.view.next);
    else questGo("view-mapper");
  }, 1400);
}

/* A "not found" report asks for one specific capture. Offered as a
 * one-tap on the report toast; nothing is forced. */
function mapperOffer(store, task) {
  if (!task || !task.prompt) return;
  M.store = store;
  toast("Help refresh the map?", {
    action: "Open the camera",
    onAction: () => {
      if (task.prompt.segment) openCapture(task.prompt);
      else questGo("view-mapper");
    }
  });
}

async function mapperUpload(blob, kind) {
  const q = `store=${encodeURIComponent(M.store)}&segment=${encodeURIComponent(M.prompt.segment)}&kind=${kind}`;
  const r = await fetch(`/api/storemap/capture?${q}`, {
    method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

async function mapperAfter() {
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
}

function mapperSharpness(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const l = -4 * g[y * w + x] + g[y * w + x - 1] + g[y * w + x + 1] + g[(y - 1) * w + x] + g[(y + 1) * w + x];
    sum += l; sq += l * l; n++;
  }
  return sq / n - (sum / n) * (sum / n);
}

$("#cp-done").addEventListener("click", () => { mcStop(); MC.gen++; MC.done = true; questGo("view-mapper"); });
$("#cp-outdated").addEventListener("click", async () => {
  if (!M.prompt || !M.prompt.segment) return;
  try {
    const out = await post("/api/storemap/outdated", { store: M.store, segment: M.prompt.segment });
    toast("Thanks. Marked out of date.");
    if (out.prompt) openCapture(out.prompt);
  } catch (e) { toast(e.message); }
});
document.addEventListener("click", ev => {
  if (ev.target.closest(".qback")) { mcStop(); MC.gen++; }
});
