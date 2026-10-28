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

/* ---------------- guided capture ---------------- */

function openCapture(prompt) {
  M.prompt = prompt;
  $("#cp-title").textContent = prompt.title;
  $("#cp-why").textContent = prompt.why || "";
  $("#cp-steps").innerHTML = (prompt.steps || []).map(t => `<li>${esc(t)}</li>`).join("");
  $("#cp-time").textContent = `About ${prompt.est_seconds || 10} seconds.`;
  const walk = prompt.kind === "walk";
  const go = $("#cp-go");
  go.textContent = walk ? "Record the walk" : "Take photo";
  go.setAttribute("for", walk ? "cp-video" : "cp-photo");
  $("#cp-result").hidden = true;
  $("#cp-after").hidden = true;
  $("#cp-outdated").hidden = !prompt.segment;
  $("#cp-photo").value = ""; $("#cp-video").value = "";
  questShow("view-capture");
}

/* A "not found" report asks for one specific photo. Offered as a
 * one-tap on the report toast; nothing is forced. */
function mapperOffer(store, task) {
  if (!task || !task.prompt) return;
  M.store = store;
  toast("Help refresh the map?", {
    action: "Take the photo",
    onAction: () => {
      if (task.prompt.segment) openCapture(task.prompt);
      else questGo("view-mapper");
    }
  });
}

function mapperShowResult(html) {
  const box = $("#cp-result");
  box.innerHTML = html; box.hidden = false;
}

async function mapperUpload(blob, kind) {
  const q = `store=${encodeURIComponent(M.store)}&segment=${encodeURIComponent(M.prompt.segment)}&kind=${kind}`;
  const r = await fetch(`/api/storemap/capture?${q}`, {
    method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}

function mapperVerdict(out) {
  if (!out.accepted) return `<strong>Try again.</strong> ${esc(out.fix)}`;
  if (out.duplicate) return "<strong>Thanks.</strong> That confirms this shelf still looks the same.";
  return out.best ? "<strong>Saved. This is now the best photo of this shelf.</strong>"
                  : "<strong>Saved.</strong> We already hold a better one, so we kept both.";
}

async function mapperAfter() {
  M.view = await api(`/api/storemap?store=${encodeURIComponent(M.store)}`);
  $("#cp-after").hidden = false;
  $("#cp-next").textContent = M.view.next ? "Next capture" : "Back to the map";
}

$("#cp-photo").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f || M.busy) return;
  M.busy = true;
  mapperShowResult("Checking the photo and blurring any people…");
  try {
    const out = await mapperUpload(f, "photo");
    mapperShowResult(mapperVerdict(out));
    if (out.accepted) await mapperAfter();
  } catch (e) { mapperShowResult(esc(e.message)); }
  M.busy = false;
});

/* A walk: sample the video, keep the sharpest frames, send those. */
function mapperSharpness(canvas) {
  const w = 160, h = Math.max(1, Math.round(canvas.height * 160 / canvas.width));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(canvas, 0, 0, w, h);
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
function mapperSeek(video, t) {
  return new Promise(res => { video.onseeked = () => res(); video.currentTime = t; });
}
async function mapperPickFrames(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.src = url;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error("Could not read that video.")); });
  const dur = video.duration || 1;
  const scale = Math.min(1, 960 / (video.videoWidth || 960));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  const cands = [];
  for (let i = 0; i < M_WALK_SAMPLES; i++) {
    await mapperSeek(video, dur * (i + 0.5) / M_WALK_SAMPLES);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
    cands.push({ blob, sharp: mapperSharpness(canvas) });
  }
  URL.revokeObjectURL(url);
  return cands.sort((a, b) => b.sharp - a.sharp).slice(0, M_WALK_SEND);
}
$("#cp-video").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f || M.busy) return;
  M.busy = true;
  try {
    mapperShowResult("Picking the sharpest frames from your walk…");
    const frames = await mapperPickFrames(f);
    let kept = 0, best = 0, fix = "";
    for (let i = 0; i < frames.length; i++) {
      mapperShowResult(`Checking frame ${i + 1} of ${frames.length} and blurring any people…`);
      const out = await mapperUpload(frames[i].blob, "walk");
      if (out.accepted) { kept++; best = Math.max(best, out.score); } else fix = fix || out.fix;
    }
    mapperShowResult(kept
      ? `<strong>Walk saved.</strong> ${kept} of ${frames.length} frames were good enough.`
      : `<strong>Try again.</strong> ${esc(fix || "No frame was sharp enough. Walk a little slower.")}`);
    if (kept) await mapperAfter();
  } catch (e) { mapperShowResult(esc(e.message)); }
  M.busy = false;
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
