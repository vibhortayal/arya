"use strict";
/* Expiry dates (owner, 2026-10-29; wireframe approved the same day).
 * The user photographs the date on a package; Spark reads it; the user
 * confirms; Arya tracks it. Nothing is saved until the user taps, a read
 * the model cannot make falls back to typing, and nothing here is red,
 * timed or counted against anyone. The photo never leaves this page's
 * memory: only the confirmed date is stored.
 * Wireframe: https://claude.ai/artifact/6g4tpYnWmo5M4gnuFCmUmr */
(function () {
  const KIND_WORD = { use_by: "use by", best_by: "best by", expires: "expires" };
  let SOON = [];
  let sheet = null;


  function dateObj(iso) { return new Date(iso + "T12:00:00"); }
  function fmtLong(iso) {
    const d = dateObj(iso);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  function fmtMD(iso) { const d = dateObj(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }
  function when(days) {
    if (days < 0) return "Past the date. Your call.";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return `in ${days} days`;
  }

  /* ---------- the one sheet ---------- */
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.className = "sheetwrap";
    sheet.id = "expiry-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "ex-title");
    sheet.hidden = true;
    sheet.innerHTML = `<div class="sheet" id="ex-body"></div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", ev => { if (ev.target === sheet) closeSheet(); });
    sheet.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Escape") closeSheet(); });
    return sheet;
  }
  let trigger = null;
  function openSheet(html) {
    ensureSheet();
    if (sheet.hidden) trigger = document.activeElement;
    $("#ex-body").innerHTML = `<span class="sheetgrip"></span>${html}`;
    sheet.hidden = false;
    const first = $("#ex-body").querySelector("[data-first]") || $("#ex-body").querySelector("button, input, select");
    if (first && first.focus) first.focus();
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    $("#ex-body").innerHTML = "";
    if (trigger && trigger.isConnected && trigger.focus) trigger.focus();
    trigger = null;
  }

  /* ---------- Today: Use soon ----------
   * The expiry home (owner, 2026-10-29): Snap an expiry date left the
   * List. Today shows what to use soon, with "+ Snap a date" in the
   * header; with nothing tracked it is one row that opens the camera. */
  function useRows() {
    return SOON.map(s => {
      const c = typeof charFor === "function" ? charFor(s.name) : "";
      return `<div class="row" tabindex="0" role="button" data-ex-item="${esc(s.item_id)}">
          ${c ? `<img class="rowface" src="assets/characters/${c}" alt="">` : ""}
          <div class="grow"><span class="name">${esc(s.name)}</span><span class="sub"><b>${fmtLong(s.date)}</b> · ${when(s.days)}</span></div>
          <button class="chip" data-ex-done="${esc(s.item_id)}" type="button">Used it</button></div>`;
    }).join("");
  }

  function paintToday(soon) {
    SOON = soon || [];
    const el = $("#today-expiry");
    if (!el) return;
    el.innerHTML = SOON.length
      ? `<div class="sectrow"><h3 class="sect">Use soon</h3><button class="linkbtn" type="button" data-ex-snap>+ Snap a date</button></div>
        <div class="group usesoon">${useRows()}</div>
        <p class="muted small listhint">Tap a row to snooze, fix the date or stop tracking.</p>`
      : `<div class="sectrow"><h3 class="sect">Use soon</h3></div>
        <div class="group"><button class="hubrow snaprow" type="button" data-ex-snap><img class="rowface" src="assets/characters/pantry.webp" alt=""><span class="hr-label">Snap an expiry date<span class="sub">Arya can keep track of expiry dates and tell you what to use soon.</span></span><span class="chev">›</span></button></div>`;
  }

  // The List no longer shows Use soon; kept so older callers no-op.
  function paintList(soon) { SOON = soon || []; }

  /* ---------- capture ---------- */
  function captureSheet() {
    const demo = typeof isDemo !== "undefined" && isDemo;
    openSheet(`<h3 class="hm-title" id="ex-title">Snap the date</h3>
      <p class="muted">Point your camera at the date on the package. Arya reads it, and you check it before anything is saved.</p>
      <label class="btn primary wide" for="ex-photo" data-first tabindex="0" role="button">Take a photo</label>
      <input type="file" id="ex-photo" accept="image/*" capture="environment" hidden>
      ${demo ? `<button class="btn wide" id="ex-sample" type="button">Try a sample date</button>` : ""}
      <p class="exlinks"><button class="linkbtn" id="ex-type" type="button">Type the date instead</button></p>`);
    $("#ex-photo").addEventListener("change", ev => { const f = ev.target.files[0]; if (f) readPhoto(f); });
    const lb = $("#ex-body label[for=ex-photo]");
    lb.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("#ex-photo").click(); } });
    if (demo) $("#ex-sample").addEventListener("click", () => readSample());
    $("#ex-type").addEventListener("click", () => typeSheet());
  }

  function readingSheet() {
    openSheet(`<h3 class="hm-title" id="ex-title">Reading the date…</h3><p class="muted" role="status">Spark is looking at the photo.</p>`);
  }

  async function readPhoto(file) {
    readingSheet();
    try {
      const r = await fetch("/api/expiry/read", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      if (!r.ok) throw new Error(friendlyError((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`));
      handleRead(await r.json());
    } catch (e) {
      cantSheet(e.message);
    }
  }
  async function readSample() {
    readingSheet();
    try { handleRead(await post("/api/expiry/read?sample=1")); }
    catch (e) { cantSheet(e.message); }
  }
  function handleRead(read) { if (read.readable) confirmSheet(read); else cantSheet(); }

  function cantSheet(why) {
    openSheet(`<h3 class="hm-title" id="ex-title">Arya couldn't read that date</h3>
      <p class="muted">${why ? esc(why) : "Glare or a curved label can hide it. No harm done."}</p>
      <button class="btn primary wide" id="ex-again" type="button" data-first>Try again</button>
      <button class="btn wide" id="ex-type" type="button">Type the date</button>
      <p class="exlinks"><button class="linkbtn" id="ex-skip" type="button">Skip for now</button></p>`);
    $("#ex-again").addEventListener("click", captureSheet);
    $("#ex-type").addEventListener("click", () => typeSheet());
    $("#ex-skip").addEventListener("click", closeSheet);
  }

  /* ---------- confirm and type ---------- */
  async function itemOptions(match) {
    let cands = [];
    try { cands = (await api("/api/list/candidates")).candidates || []; } catch (e) { cands = []; }
    cands.sort((a, b) => (b.on_list - a.on_list) || a.name.localeCompare(b.name));
    const seen = new Set(), opts = [];
    const add = (id, name, tag) => { if (!id || seen.has(id)) return; seen.add(id); opts.push({ id, name, tag }); };
    if (match) add(match.item_id, match.name, "");
    cands.forEach(c => add(c.item_id, c.name, c.on_list ? " (on your list)" : ""));
    return opts;
  }
  function itemSelect(opts, readName) {
    return `<select id="ex-item" aria-label="Item">${opts.map(o => `<option value="${esc(o.id)}">${esc(o.name + o.tag)}</option>`).join("")}<option value="">${opts.length ? "A different item…" : "Name the item…"}</option></select>
      <input type="text" id="ex-name" placeholder="What is it?" value="${esc(opts.length ? "" : readName || "")}" ${opts.length ? "hidden" : ""} aria-label="Item name" autocomplete="off">`;
  }
  function wireItemSelect() {
    const sel = $("#ex-item"), nm = $("#ex-name");
    sel.addEventListener("change", () => { nm.hidden = sel.value !== ""; if (!nm.hidden) nm.focus(); });
    sel.dispatchEvent(new Event("change"));
  }
  const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

  async function confirmSheet(read) {
    const opts = await itemOptions(read.match);
    const name = read.match ? read.match.name : (read.name || "This item");
    const word = KIND_WORD[read.kind] || "date";
    openSheet(`<p class="dow nomargin">Arya read</p>
      ${read.raw ? `<div class="excrop">${esc(read.raw)}</div>` : ""}
      <h3 class="bigdate" id="ex-title">${esc(name)}, ${word} ${fmtMD(read.date)}</h3>
      <p class="muted nomargin">${fmtLong(read.date)} · ${when(Math.round((dateObj(read.date) - dateObj(todayISO())) / 864e5))}</p>
      <div class="exkv"><span class="exk">Item</span><span class="exv">${itemSelect(opts, read.name)}</span></div>
      <div class="exkv"><span class="exk">Date</span><span class="exv"><input type="date" id="ex-date" value="${esc(read.date)}" aria-label="Date"></span></div>
      <button class="btn primary wide" id="ex-save" type="button" data-first>Looks right, track it</button>
      <p class="muted small excenter">Nothing is saved until you tap. Arya keeps the date, not the photo.</p>`);
    wireItemSelect();
    $("#ex-save").addEventListener("click", () => save(read.kind));
  }

  async function typeSheet(item) {
    const opts = item ? [{ id: item.item_id, name: item.name, tag: "" }] : await itemOptions(null);
    openSheet(`<h3 class="hm-title" id="ex-title">${item ? "Fix the date" : "Type the date"}</h3>
      <div class="exkv"><span class="exk">Item</span><span class="exv">${itemSelect(opts, "")}</span></div>
      <div class="exkv"><span class="exk">Date</span><span class="exv"><input type="date" id="ex-date" value="${item ? esc(item.date) : ""}" aria-label="Date"></span></div>
      <button class="btn primary wide" id="ex-save" type="button" data-first>Track it</button>`);
    wireItemSelect();
    $("#ex-save").addEventListener("click", () => save("unknown"));
  }

  async function save(kind) {
    const date = $("#ex-date").value, id = $("#ex-item").value, name = ($("#ex-name").value || "").trim();
    if (!date) { toast("Pick the date first."); return; }
    if (!id && !name) { toast("Say what the item is."); return; }
    const btn = $("#ex-save"); btn.disabled = true;
    try {
      const out = await post("/api/expiry/save", id ? { item_id: id, date, kind } : { name, date, kind });
      closeSheet();
      toast(`Tracking ${out.name} until ${fmtMD(out.date)}.`);
      refresh(lastView);
    } catch (e) { btn.disabled = false; toast(e.message); }
  }

  /* ---------- one item ---------- */
  function itemSheet(id) {
    const s = SOON.find(x => x.item_id === id);
    if (!s) return;
    const c = typeof charFor === "function" ? charFor(s.name) : "";
    openSheet(`<div class="exhead">${c ? `<img class="rowface" src="assets/characters/${c}" alt="">` : ""}<div><h3 class="hm-title" id="ex-title">${esc(s.name)}</h3><p class="muted nomargin">${fmtLong(s.date)} · ${when(s.days)}</p></div></div>
      <button class="btn primary wide" id="ex-done" type="button" data-first>Used it</button>
      <button class="btn wide" id="ex-snooze" type="button">Remind me in 2 days</button>
      <button class="btn wide" id="ex-fix" type="button">Fix the date</button>
      <p class="exlinks"><button class="linkbtn" id="ex-stop" type="button">Stop tracking this</button></p>`);
    $("#ex-done").addEventListener("click", () => { closeSheet(); done(s); });
    $("#ex-snooze").addEventListener("click", async () => {
      closeSheet();
      try { await post(`/api/expiry/${encodeURIComponent(id)}/snooze`); toast(`${s.name}: Arya will check in again in 2 days.`); refresh(lastView); }
      catch (e) { toast(e.message); }
    });
    $("#ex-fix").addEventListener("click", () => typeSheet(s));
    $("#ex-stop").addEventListener("click", async () => {
      closeSheet();
      try { await post(`/api/expiry/${encodeURIComponent(id)}/stop`); toast(`Stopped tracking ${s.name}.`); refresh(lastView); }
      catch (e) { toast(e.message); }
    });
  }

  async function done(s) {
    try { await post(`/api/expiry/${encodeURIComponent(s.item_id)}/done`); }
    catch (e) { toast(e.message); return; }
    refresh(lastView);
    // Used up: offer, never assume, to put it back on the shopping list.
    toast(`Done with ${s.name}. Add it to your list?`, {
      action: "Add",
      onAction: async () => {
        try { await post("/api/list/add", { item_id: s.item_id }); toast(`${s.name} is on your list.`); refresh(lastView); }
        catch (e) { toast(e.message); }
      }
    });
  }

  document.addEventListener("click", ev => {
    const d = ev.target.closest("[data-ex-done]");
    if (d) { const s = SOON.find(x => x.item_id === d.dataset.exDone); if (s) done(s); return; }
    const r = ev.target.closest("[data-ex-item]");
    if (r) { itemSheet(r.dataset.exItem); return; }
    if (ev.target.closest("[data-ex-snap]")) captureSheet();
  });
  document.addEventListener("keydown", ev => {
    const r = ev.target.closest && ev.target.closest("[data-ex-item]");
    if (r && ev.target === r && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); itemSheet(r.dataset.exItem); }
  });

  window.Expiry = { paintToday, paintList, captureSheet };
})();
