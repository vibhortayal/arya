"use strict";
/* Arya hunt menu — the plan changes in the aisle (hunt slice).
 *
 * Loaded right after quest.js. It adds, to the hunt that already
 * exists, everything the shopper needs when the list and the shelf
 * disagree: leave items for next time, a row menu (find, swap, it
 * moved, save, drop, quantity and note), "Forgot something?", the
 * "Left for next time" fold, and "Found it after all". It adds no game
 * and no pressure: nothing here files a report unless the shopper
 * taps the explicit button, and nothing is ever shown as a failure.
 *
 * Wiring, all guarded in quest.js: window.huntAfterRender(sess) runs at
 * the end of renderHunt, window.huntAfterGrab(sess, idx) after a grab.
 * Capture-phase listeners on the hunt and Express views take over
 * #btn-finish, #exp-finish and #btn-nothere only when there is
 * something to ask; otherwise the existing handlers run unchanged.
 *
 * The pure helpers (Hunt.huntSubstitutes, applyLeave, applyRestore,
 * applyEdit, applyForgot) mirror api/hunt.py so a change made offline
 * lands the same way on the phone as on the server later. Everything
 * sits in one closure so loading it beside quest.js adds no globals
 * except window.Hunt, huntAfterRender and huntAfterGrab. */
(function () {
  const NAME_MAX = 80, NOTE_MAX = 60, QTY_MIN = 1, QTY_MAX = 99, ITEMS_MAX = 200;
  const HOWS = ["saved", "dropped"];
  const nrm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const keyOf = name => "name:" + nrm(name);
  const clone = o => JSON.parse(JSON.stringify(o));
  function fail(msg, code) { const e = new Error(msg); e.code = code || 400; return e; }

  /* ------------------------------------------------------------------
   * Pure mirrors of api/hunt.py. Each mutates the session object in
   * place and returns what it did, or throws an Error with the same
   * refusal the server would give.
   * ---------------------------------------------------------------- */
  function cleanName(raw) {
    const name = String(raw == null ? "" : raw).split(/\s+/).filter(Boolean).join(" ");
    if (!name) throw fail("name is required");
    if (name.length > NAME_MAX) throw fail(`name is too long (max ${NAME_MAX})`);
    return name;
  }
  function cleanQty(raw) {
    let n = raw;
    if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) n = Number(raw);
    if (typeof n !== "number" || !Number.isInteger(n)) throw fail("qty must be a whole number");
    if (n < QTY_MIN || n > QTY_MAX) throw fail(`qty must be ${QTY_MIN} to ${QTY_MAX}`);
    return n;
  }
  function cleanNote(raw) {
    if (raw == null) return "";
    if (typeof raw !== "string") throw fail("note must be text");
    const note = raw.trim();
    if (note.length > NOTE_MAX) throw fail(`note is too long (max ${NOTE_MAX})`);
    return note;
  }
  function findIn(list, name) {
    const n = nrm(name);
    for (let i = 0; i < list.length; i++) if (nrm(list[i].name) === n) return i;
    const key = keyOf(name);
    for (let i = 0; i < list.length; i++) if (list[i].group === key) return i;
    return -1;
  }
  function lists(sess) {
    if (!Array.isArray(sess.items)) sess.items = [];
    if (!Array.isArray(sess.left)) sess.left = [];
    return [sess.items, sess.left];
  }
  function itemFromLeft(entry) {
    const item = {};
    for (const k of Object.keys(entry)) if (!["how", "idx", "at", "swapped_for"].includes(k)) item[k] = entry[k];
    item.checked = false;
    return item;
  }
  function nowIso() { return new Date().toISOString().slice(0, 19); }

  function applyLeave(sess, entries, now) {
    if (!Array.isArray(entries) || !entries.length) throw fail("entries is required");
    if (entries.length > ITEMS_MAX) throw fail("too many entries");
    const [items, left] = lists(sess);
    const plan = [], seen = new Set();
    for (const e of entries) {
      if (!e || typeof e !== "object") throw fail("each entry needs an item and how");
      const how = e.how === undefined ? "saved" : e.how;
      if (!HOWS.includes(how)) throw fail(`how must be one of ${HOWS.join(", ")}`);
      const name = cleanName(e.item);
      const i = findIn(items, name);
      if (i < 0) {
        if (findIn(left, name) >= 0) continue;          // already left: idempotent
        throw fail(`no such item: ${name}`, 404);
      }
      if (items[i].checked) throw fail(`${items[i].name} is in your cart. Put it back first.`);
      if (!seen.has(i)) { seen.add(i); plan.push([i, how]); }
    }
    const at = now || nowIso();
    const moved = plan.map(([i, how]) => {
      const entry = {};
      for (const k of Object.keys(items[i])) if (k !== "checked") entry[k] = items[i][k];
      return Object.assign(entry, { how, idx: i, at });
    });
    sess.items = items.filter((_, j) => !seen.has(j));
    left.push(...moved);
    return moved;
  }
  function applyRestore(sess, name) {
    const [items, left] = lists(sess);
    const i = findIn(left, cleanName(name));
    if (i < 0) throw fail(`no such item: ${name}`, 404);
    const entry = left[i];
    const item = itemFromLeft(entry);
    const j = findIn(items, item.name);
    if (j >= 0) {
      items[j].qty = Math.min(QTY_MAX, (Number(items[j].qty) || 1) + (Number(item.qty) || 1));
      items[j].checked = false;
      left.splice(i, 1);
      return items[j];
    }
    if (items.length >= ITEMS_MAX) throw fail("the hunt is full");
    left.splice(i, 1);
    const pos = Number.isInteger(entry.idx) ? Math.max(0, Math.min(entry.idx, items.length)) : items.length;
    items.splice(pos, 0, item);
    return item;
  }
  function applyEdit(sess, name, qty, note) {
    const [items] = lists(sess);
    const i = findIn(items, cleanName(name));
    if (i < 0) throw fail(`no such item: ${name}`, 404);
    if (qty == null && note == null) throw fail("nothing to change");
    const q = qty != null ? cleanQty(qty) : null;
    const n = note != null ? cleanNote(note) : null;
    const it = items[i];
    if (q != null) it.qty = q;
    if (n != null) { if (n) it.note = n; else delete it.note; }
    return it;
  }
  function applyForgot(sess, name, qty, note) {
    name = cleanName(name);
    const n = cleanQty(qty == null ? 1 : qty);
    note = cleanNote(note);
    const [items, left] = lists(sess);
    const k = findIn(left, name);
    if (k >= 0) {
      const how = left[k].how;
      const item = applyRestore(sess, name);
      // The typed quantity (above 1) and note count, like the server.
      if (n > 1) item.qty = n;
      if (note) item.note = note;
      return { result: "restored", reopened: false, prevQty: null, how, item };
    }
    const i = findIn(items, name);
    if (i >= 0) {
      const it = items[i];
      const prev = Number(it.qty) || 1;
      const reopened = !!it.checked;
      it.qty = Math.min(QTY_MAX, prev + n);
      it.checked = false;
      if (note) it.note = note;
      return { result: "merged", reopened, prevQty: prev, item: it };
    }
    if (items.length >= ITEMS_MAX) throw fail("the hunt is full");
    const item = { name, qty: n, checked: false, group: keyOf(name), added_mid_hunt: true };
    if (note) item.note = note;
    items.push(item);        // no shelf data offline: the end of the list
    return { result: "added", reopened: false, prevQty: null, item };
  }

  /* Substitutes for an out-of-stock item, from the household's own
   * receipt history (the /api/quest/plan items): they share a name
   * token with the original, are not already on the hunt, and the ones
   * bought at this store come first. Never invented. */
  const STOP = new Set(["the", "and", "for", "with", "gal", "oz", "lb", "lbs", "pack", "pk", "ct", "fresh", "organic", "large", "small", "each"]);
  function tokens(name) {
    return nrm(name).split(" ").filter(t => t.length > 2 && !/^\d/.test(t) && !STOP.has(t));
  }
  function sameStore(a, b) {
    const x = nrm(a), y = nrm(b);
    return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
  }
  function huntSubstitutes(sess, planItems, name, store, max) {
    const want = new Set(tokens(name));
    const onHunt = new Set([...(sess.items || []), ...(sess.left || [])].map(i => nrm(i.name)));
    onHunt.add(nrm(name));
    const seen = new Set(), out = [];
    for (const p of planItems || []) {
      const n = nrm(p.name);
      if (!n || onHunt.has(n) || seen.has(n)) continue;
      if (!tokens(p.name).some(t => want.has(t))) continue;
      seen.add(n);
      const stores = p.stores || {};
      let here = 0, total = 0;
      for (const [s, c] of Object.entries(stores)) { total += c; if (sameStore(s, store)) here += c; }
      out.push({ name: p.name, here, total });
    }
    out.sort((a, b) => (b.here - a.here) || (b.total - a.total) || a.name.localeCompare(b.name));
    return out.slice(0, max || 3);
  }

  /* ------------------------------------------------------------------
   * The shared sheet (#hunt-sheet): one dialog for every menu.
   * ---------------------------------------------------------------- */
  const ui = { trigger: null, restoreSel: "", onAct: null, leftOpen: false, planTried: false, chipsKey: "", leftKey: "", choice: {}, edit: null };
  const sheetEl = () => $("#hunt-sheet");
  const sheetOpen = () => { const s = sheetEl(); return !!s && !s.hidden; };
  function inSheet(el) {
    return !!(el && el.closest && (el.closest("#hunt-sheet") || el.closest("#spot-sheet")));
  }
  function openSheet(html, trigger, restoreSel) {
    const sh = sheetEl(), body = $("#hm-body");
    if (!sh || !body) return;
    body.innerHTML = html;
    ui.trigger = trigger || document.activeElement || null;
    ui.restoreSel = restoreSel || "";
    sh.hidden = false;
    focusFirst();
  }
  function focusFirst() {
    const body = $("#hm-body");
    const first = body && (body.querySelector("[data-first]") || body.querySelector("button, input, select, textarea"));
    if (first && first.focus) first.focus();
  }
  function closeSheet(skipFocus) {
    const sh = sheetEl();
    if (!sh || sh.hidden) return;
    sh.hidden = true;
    const body = $("#hm-body");
    if (body) body.innerHTML = "";
    ui.onAct = null;
    if (skipFocus) return;
    let el = ui.trigger;
    if (!(el && el.isConnected !== false && el.focus) && ui.restoreSel) el = document.querySelector(ui.restoreSel);
    if (el && el.focus) el.focus();
    ui.trigger = null;
  }
  const sheetHtml = (title, sub, inner) =>
    `<h3 class="hm-title" id="hm-title">${title}</h3>${sub ? `<p class="sub hm-sub">${sub}</p>` : ""}${inner}`;

  /* ------------------------------------------------------------------
   * Changes: online first, the phone's outbox when the signal is gone.
   * ---------------------------------------------------------------- */
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  function afterMutation(sess) {
    Q.focusIdx = -1;
    if (Q.current === sess) renderCurrent();
  }
  /* Run one change. mirror(sess) is the pure local rule; it runs first
   * on a copy to check the change and learn what it does. Online, the
   * server answers with the session. Offline, leave/restore/edit/forgot
   * apply on the phone and wait in the outbox, in order. */
  async function mutate(sess, op, body, mirror) {
    let res;
    try { res = mirror(clone(sess)); }
    catch (e) { toast(e.message); return { ok: false }; }
    // Wait for any replay in progress, so this change goes after it.
    if (typeof qOutbox === "function" && qOutbox().length && !offline()) await qFlushOutbox();
    try {
      if (offline()) throw new TypeError("No connection");
      const s = await post(`/api/quest/sessions/${sess.id}/${op}`, body);
      // "forgot" is the server's own account of what it did with the
      // typed name. It is a side note, not session state.
      const server = s && s.forgot;
      delete s.forgot;
      Object.assign(sess, s);
      delete sess.new_sticker;
      return { ok: true, queued: false, res, server };
    } catch (e) {
      if (!(e instanceof TypeError)) { toast(e.message); return { ok: false }; }
      try { mirror(sess); } catch (err) { toast(err.message); return { ok: false }; }
      qOutboxSave([...qOutbox(), { sid: sess.id, op, body }]);
      qPaintOffline();
      return { ok: true, queued: true, res };
    }
  }
  /* Changes that need the server (a swap, a report taken back). */
  async function online(sess, op, body) {
    if (offline()) { toast("No signal. This needs a connection."); return null; }
    try {
      const s = await post(`/api/quest/sessions/${sess.id}/${op}`, body);
      Object.assign(sess, s);
      delete sess.new_sticker;
      return s;
    } catch (e) {
      toast(e instanceof TypeError ? "No signal. This needs a connection." : e.message);
      return null;
    }
  }
  const leaveBody = entries => ({ entries: entries.map(e => ({ item: e.item, how: e.how })) });
  const byIdx = (a, b) => a.idx - b.idx;

  async function leaveItems(sess, entries) {
    const r = await mutate(sess, "leave", leaveBody(entries), s => applyLeave(s, entries));
    if (!r.ok) return null;
    afterMutation(sess);
    return r.res;                       // the moved entries (name, how, idx)
  }
  async function restoreItems(sess, moved) {
    for (const m of moved.slice().sort(byIdx)) {
      await mutate(sess, "restore", { item: m.name }, s => applyRestore(s, m.name));
    }
    afterMutation(sess);
  }

  /* ------------------------------------------------------------------
   * Leave sheet: "I'm done shopping" with items still open.
   * ---------------------------------------------------------------- */
  const openItems = sess => (sess.items || []).filter(i => !i.checked && !qIsReportedByMe(sess, i));
  function leaveSheet(trigger) {
    const sess = Q.current;
    if (!sess) return;
    if (!openItems(sess).length) return;
    // Rows reported missing on this trip join the sheet, so the shopper
    // can save or drop them with the rest.
    const open = (sess.items || []).filter(i => !i.checked);
    ui.choice = {};
    open.forEach(it => { ui.choice[it.name] = "saved"; });
    const rows = open.map((it, k) => `<div class="row hm-leaverow">
      <div class="grow"><span class="name">${esc(it.name)}${qtyTag(it) ? ` - ${esc(qtyTag(it))}` : ""}</span>${qIsReportedByMe(sess, it) ? `<span class="sub">Reported missing</span>` : ""}</div>
      <div class="hm-seg" role="group" aria-label="What to do with ${esc(it.name)}">
        <button type="button" class="hm-segbtn" data-act="how" data-k="${k}" data-how="saved" aria-pressed="true">Next trip</button>
        <button type="button" class="hm-segbtn" data-act="how" data-k="${k}" data-how="dropped" aria-pressed="false">Drop</button>
      </div></div>`).join("");
    openSheet(sheetHtml(`Leave ${open.length} for next time?`,
      "Nothing is lost. Saved items come first on your next trip.",
      `<div class="group hm-leavelist">${rows}</div>
       <button type="button" class="btn primary wide hm-main" data-act="checkout">Check out</button>
       <button type="button" class="btn wide" data-act="keep" data-first>Keep hunting</button>`), trigger, "#btn-finish");
    ui.onAct = async (act, el) => {
      if (act === "how") {
        const it = open[Number(el.dataset.k)];
        ui.choice[it.name] = el.dataset.how;
        el.parentNode.querySelectorAll("[data-how]").forEach(b => b.setAttribute("aria-pressed", String(b === el)));
      } else if (act === "keep") {
        closeSheet();
      } else if (act === "checkout") {
        el.disabled = true;
        const entries = open.map(it => ({ item: it.name, how: ui.choice[it.name] || "saved" }));
        // One call with every choice. It never files a report.
        const moved = await leaveItems(sess, entries);
        if (!moved) { el.disabled = false; return; }
        closeSheet(true);
        const n = moved.length;
        toast(`${n} left for next time.`, { action: "Undo", onAction: async () => {
          await restoreItems(sess, moved);
          const fin = $("#view-finish");
          if (fin && !fin.hidden) questBack();
        } });
        openFinish(sess);
      }
    };
  }

  /* ------------------------------------------------------------------
   * Row menu and its sheets.
   * ---------------------------------------------------------------- */
  const opt = (act, title, desc) =>
    `<button type="button" class="hm-opt" data-act="${act}"><b>${title}</b><span class="sub">${desc}</span></button>`;
  const idxOf = (sess, name) => (sess.items || []).findIndex(i => i.name === name);
  function rowMenu(idx, trigger) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it) return;
    const name = it.name;
    // A row already reported missing is handled. Its menu only lets the
    // shopper keep it for next trip or drop it (the report stays).
    const reported = qIsReportedByMe(sess, it);
    const opts = reported
      ? `${opt("save", "Save for next trip", "It comes first on your next trip.")}
        ${opt("drop", "Don't need it today", "Your report stays. Nothing is lost.")}`
      : `${opt("find", "Find it for me", "Point your camera at the shelf.")}
        ${opt("swap", "Swap it", "Pick a substitute. Your quantity carries over.")}
        ${opt("moved", "It moved", "Look again, or tell other shoppers.")}
        ${opt("save", "Save for next trip", "It comes first on your next trip.")}
        ${opt("drop", "Don't need it today", "No report. Nothing is lost.")}
        ${opt("edit", "Change quantity or note", "Fix how many, or add a note.")}`;
    openSheet(sheetHtml(esc(name), reported ? "You told other shoppers it is gone." : "",
      `<div class="hm-opts">
        ${opts}
       </div>
       <button type="button" class="btn wide" data-act="close">Close</button>`), trigger, `[data-more="${idx}"]`);
    ui.onAct = async act => {
      const i = idxOf(sess, name);
      if (act === "close") { closeSheet(); return; }
      if (i < 0) { closeSheet(); return; }
      if (act === "find") {
        if (sess.state !== "playing") { toast("Start the hunt first."); return; }
        closeSheet(true);
        Q.scanTarget = name;
        openScanView().catch(showErr);
      } else if (act === "swap") { swapSheet(i, trigger); }
      else if (act === "moved") { movedSheet(i, trigger); }
      else if (act === "edit") { editSheet(i, trigger); }
      else if (act === "save" || act === "drop") {
        closeSheet(true);
        const how = act === "save" ? "saved" : "dropped";
        const moved = await leaveItems(sess, [{ item: name, how }]);
        if (!moved) return;
        toast(act === "save" ? `${name} saved for next trip.` : `${name} dropped for today.`,
          { action: "Undo", onAction: () => restoreItems(sess, moved) });
        focusAfter(trigger);
      }
    };
  }
  function focusAfter(trigger) {
    const list = $("#hunt-list");
    const el = list && list.querySelector && list.querySelector("[data-more]");
    if (el && el.focus) el.focus();
  }

  function movedSheet(idx, trigger) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it) return;
    const stop = qStops(sess)[idx];
    const where = stop && stop.shelfLabel ? esc(stop.shelfLabel) : "not placed on the map yet";
    openSheet(sheetHtml(`Can't find ${esc(it.name)}?`,
      `Last seen: ${where}. Check the end caps too.`,
      `<button type="button" class="btn primary wide hm-main" data-act="find" data-first>Find it for me</button>
       <button type="button" class="btn wide" data-act="tell">Tell other shoppers it is gone</button>
       <button type="button" class="btn wide" data-act="keep">Keep looking</button>`), trigger, "#btn-nothere");
    const name = it.name;
    ui.onAct = act => {
      if (act === "keep") { closeSheet(); }
      else if (act === "find") {
        if (sess.state !== "playing") { toast("Start the hunt first."); return; }
        closeSheet(true);
        Q.scanTarget = name;
        openScanView().catch(showErr);
      } else if (act === "tell") {
        // The existing report sheet is the explicit confirm: nothing
        // is filed until its Send button.
        closeSheet(true);
        const i = idxOf(sess, name);
        if (i >= 0) {
          openSpotSheet(i);
          const first = document.querySelector("#spot-sheet [data-kind]");
          if (first && first.focus) first.focus();
        }
      }
    };
  }

  async function swapSheet(idx, trigger) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it) return;
    if (offline()) { toast("No signal. A swap needs a connection."); return; }
    if (!Q.plan || !Q.plan.items) {
      try { Q.plan = await api("/api/quest/plan"); } catch (e) { Q.plan = { list: [], items: [] }; }
    }
    const name = it.name;
    const subs = huntSubstitutes(sess, Q.plan.items, name, sess.store, 3);
    const rows = subs.map((s, k) => `<button type="button" class="hm-opt" data-act="pick" data-k="${k}"><b>${esc(s.name)}</b><span class="sub">${s.here ? `You bought it here ${s.here} time${s.here === 1 ? "" : "s"}.` : "You bought it at another store."}</span></button>`).join("");
    openSheet(sheetHtml(`Swap ${esc(name)}`,
      `Your quantity carries over. ${esc(name)} is saved for next trip.`,
      `${rows ? `<div class="hm-opts">${rows}</div>` : `<p class="sub">Your receipts show no close match. Type your own.</p>`}
       <label class="hm-label" for="hm-own">Type my own</label>
       <div class="hm-addrow"><input type="text" id="hm-own" class="hm-addinput" maxlength="${NAME_MAX}" autocomplete="off" enterkeyhint="done">
       <button type="button" class="btn primary" data-act="own">Use</button></div>
       <button type="button" class="btn wide" data-act="close">Cancel</button>`), trigger, `[data-more="${idx}"]`);
    const doSwap = async to => {
      to = String(to || "").trim();
      if (!to) { toast("Type a name first."); return; }
      closeSheet(true);
      const s = await online(sess, "swap", { item: name, to });
      if (!s) return;
      const j = sess.items.findIndex(i => nrm(i.name) === nrm(to) || i.swapped_from === name);
      const subName = j >= 0 ? sess.items[j].name : to;
      // The substitute stays open and becomes the suggested next.
      Q.focusIdx = j;
      renderCurrent();
      toast(`Swapped for ${subName}. ${name} is saved for next trip.`, { action: "Undo", onAction: async () => {
        if (await online(sess, "unswap", { to: subName })) afterMutation(sess);
      } });
    };
    ui.onAct = (act, el) => {
      if (act === "close") closeSheet();
      else if (act === "pick") doSwap(subs[Number(el.dataset.k)].name);
      else if (act === "own") doSwap($("#hm-own").value);
    };
    const own = $("#hm-own");
    if (own) own.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); doSwap(own.value); } });
  }

  function editSheet(idx, trigger) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it) return;
    const name = it.name;
    const prev = { qty: Number(it.qty) || 1, note: it.note || "" };
    ui.edit = { qty: prev.qty };
    openSheet(sheetHtml(esc(name), "Fix how many, or add a note.",
      `<div class="row hm-stepper"><span class="name" id="hm-qlabel">Quantity</span>
         <div class="hm-step" role="group" aria-labelledby="hm-qlabel">
           <button type="button" class="hm-stepbtn" data-act="minus" aria-label="One fewer">-</button>
           <b id="hm-qty" aria-live="polite">${ui.edit.qty}</b>
           <button type="button" class="hm-stepbtn" data-act="plus" aria-label="One more">+</button>
         </div></div>
       <label class="hm-label" for="hm-note">Note (size, brand, for whom)</label>
       <input type="text" id="hm-note" class="hm-addinput hm-wide" maxlength="${NOTE_MAX}" value="${esc(prev.note)}" autocomplete="off">
       <button type="button" class="btn primary wide hm-main" data-act="save">Save</button>
       <button type="button" class="btn wide" data-act="close">Cancel</button>`), trigger, `[data-more="${idx}"]`);
    const paint = () => { $("#hm-qty").textContent = String(ui.edit.qty); };
    ui.onAct = async act => {
      if (act === "close") { closeSheet(); return; }
      if (act === "minus") { ui.edit.qty = Math.max(QTY_MIN, ui.edit.qty - 1); paint(); return; }
      if (act === "plus") { ui.edit.qty = Math.min(QTY_MAX, ui.edit.qty + 1); paint(); return; }
      if (act === "save") {
        const note = ($("#hm-note").value || "").trim();
        const qty = ui.edit.qty;
        if (qty === prev.qty && note === prev.note) { closeSheet(); return; }
        closeSheet(true);
        const body = { item: name, qty, note };
        const r = await mutate(sess, "edit", body, s => applyEdit(s, name, qty, note));
        if (!r.ok) return;
        afterMutation(sess);
        toast(`${name} updated.`, { action: "Undo", onAction: async () => {
          const back = { item: name, qty: prev.qty, note: prev.note };
          await mutate(sess, "edit", back, s => applyEdit(s, name, back.qty, back.note));
          afterMutation(sess);
        } });
        focusAfter(trigger);
      }
    };
    const note = $("#hm-note");
    if (note) note.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); ui.onAct("save"); } });
  }

  /* ------------------------------------------------------------------
   * Forgot something: the card under the list.
   * ---------------------------------------------------------------- */
  const forgotMsg = (r, typed) => {
    const name = (r.item && r.item.name) || typed;
    if (r.result === "merged") return `${name} already on the list, now x${r.item.qty}.`;
    if (r.result === "restored") return `${name} is back on the list.`;
    return `${name} added.`;
  };
  /* Add one item. Returns an undo function, or null if nothing changed. */
  async function forgotOne(sess, name, qty, note) {
    const body = { name, qty, note: note || "" };
    const r = await mutate(sess, "forgot", body, s => applyForgot(s, name, qty, note));
    if (!r.ok) return null;
    // Online, the server's answer wins: it knows the dictionary (a typed
    // "whole milk" can merge into "Whole Milk 1 gal"). The phone's own
    // guess is for the queued path only.
    let res = r.res;
    if (!r.queued && r.server && r.server.item) {
      res = { result: r.server.result, reopened: !!r.server.reopened, prevQty: r.server.prev_qty,
              how: r.server.how, item: r.server.item };
    }
    const typed = cleanName(name);
    const undo = async () => {
      if (res.result === "added") {
        // Look at the outbox now, not at what it held when the item was
        // added: the queue may have synced since.
        if (qOutbox().length && !offline()) await qFlushOutbox();
        const out = qOutbox();
        const k = out.findIndex(e => e.op === "forgot" && e.sid === sess.id && nrm(e.body && e.body.name) === nrm(typed));
        if (k >= 0) {
          // Still in the outbox: take it out and remove it on the phone.
          qOutboxSave(out.filter((_, n) => n !== k));
          const at = findIn(sess.items, typed);
          if (at >= 0) sess.items.splice(at, 1);
          qPaintOffline();
        } else if (!(await online(sess, "remove-added", { item: res.item.name }))) return;
      } else if (res.result === "merged") {
        const back = { item: res.item.name, qty: res.prevQty };
        await mutate(sess, "edit", back, s => applyEdit(s, back.item, back.qty));
        if (res.reopened) { try { await qCheck(sess, res.item.name, true); } catch (e) { toast(e.message); } }
      } else if (res.result === "restored") {
        await mutate(sess, "leave", { entries: [{ item: res.item.name, how: res.how || "saved" }] },
          s => applyLeave(s, [{ item: res.item.name, how: res.how || "saved" }]));
      }
      afterMutation(sess);
    };
    return { msg: forgotMsg(res, typed), undo };
  }
  async function submitForgot(text) {
    const sess = Q.current;
    if (!sess || !String(text || "").trim()) return;
    const lines = qParseLines(text);
    const done = [];
    for (const ln of lines) {
      let qty = ln.qty;
      if (!(qty >= QTY_MIN && qty <= QTY_MAX)) qty = 1;
      const one = await forgotOne(sess, ln.name, qty, "");
      if (one) done.push(one);
    }
    if (!done.length) return;
    afterMutation(sess);
    const msg = done.length === 1 ? done[0].msg : `${done.length} items added.`;
    toast(msg, { action: "Undo", onAction: async () => { for (const d of done.slice().reverse()) await d.undo(); } });
  }
  function wireForgot() {
    const input = $("#hm-add-input"), btn = $("#hm-add-btn");
    if (!input || !btn) return;
    const go = async () => {
      const text = input.value;
      if (!text.trim()) { toast("Type an item first."); return; }
      input.value = "";
      await submitForgot(text);
    };
    btn.addEventListener("click", go);
    input.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    if (window.wireRecordButton && $("#hm-add-mic")) {
      wireRecordButton($("#hm-add-mic"), $("#hm-add-status"), text => { input.value = text; });
    }
    const chips = $("#hm-add-chips");
    if (chips) chips.addEventListener("click", ev => {
      const c = ev.target.closest("[data-usual]");
      if (c) submitForgot(c.dataset.usual);
    });
  }
  function paintChips(sess) {
    const host = $("#hm-add-chips");
    if (!host) return;
    let html = "";
    if (typeof qPlanUsuals === "function" && Q.plan && Q.plan.items && !offline() && sess.state !== "done") {
      const have = new Set([...(sess.items || []), ...(sess.left || [])].map(i => nrm(i.name)));
      const usual = qPlanUsuals(sess.store).filter(u => !have.has(nrm(u.name))).slice(0, 4);
      html = usual.map(u => `<button type="button" class="chip hm-chip" data-usual="${esc(u.name)}">+ ${esc(u.name)}</button>`).join("");
    }
    if (html !== ui.chipsKey) { ui.chipsKey = html; host.innerHTML = html; }
    host.hidden = !html;
  }

  /* ------------------------------------------------------------------
   * The left fold.
   * ---------------------------------------------------------------- */
  function paintLeft(sess) {
    const host = $("#hunt-left");
    if (!host) return;
    const left = sess.left || [];
    let html = "";
    if (left.length) {
      html = `<div class="group hm-leftgroup"><button type="button" class="hm-leftbar" data-act="fold" aria-expanded="${String(ui.leftOpen)}"><span>Left for next time (${left.length})</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="hm-chev${ui.leftOpen ? " open" : ""}"><path d="M6 9l6 6 6-6"/></svg></button>`;
      if (ui.leftOpen) {
        html += left.map((e, k) => `<div class="row hm-leftrow"><div class="grow"><span class="name">${esc(e.name)}${qtyTag(e) ? ` - ${esc(qtyTag(e))}` : ""}</span><span class="sub">${e.how === "dropped" ? "Not needed today" : "Saved for next trip"}</span></div><button type="button" class="btn" data-back="${k}" aria-label="Bring back ${esc(e.name)}">Bring back</button></div>`).join("");
      }
      html += `</div>`;
    }
    const key = html;
    if (key !== ui.leftKey) { ui.leftKey = key; host.innerHTML = html; }
    host.hidden = !left.length;
  }
  async function bringBack(k) {
    const sess = Q.current, e = sess && (sess.left || [])[k];
    if (!e) return;
    const name = e.name, how = e.how || "saved";
    const r = await mutate(sess, "restore", { item: name }, s => applyRestore(s, name));
    if (!r.ok) return;
    afterMutation(sess);
    toast(`${name} is back on the list.`, { action: "Undo", onAction: async () => {
      await mutate(sess, "leave", { entries: [{ item: name, how }] }, s => applyLeave(s, [{ item: name, how }]));
      afterMutation(sess);
    } });
  }

  /* ------------------------------------------------------------------
   * Found it after all, and the pinned finder line.
   * ---------------------------------------------------------------- */
  async function foundIt(idx) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it) return;
    const name = it.name;
    if (!(await qWithdrawReport(sess, name, true))) return;
    const j = idxOf(sess, name);
    if (j >= 0) await collectStop(j);
  }
  function unfind(idx) {
    const sess = Q.current, it = sess && sess.items[idx];
    if (!it || !Q.found) return;
    delete Q.found[it.name];
    qHuntUiSave(sess);
    renderCurrent();
  }

  /* ------------------------------------------------------------------
   * Hooks called by quest.js.
   * ---------------------------------------------------------------- */
  function huntAfterRender(sess) {
    if (!sess) return;
    const fin = $("#btn-finish");
    if (fin) {
      const open = openItems(sess).length > 0;
      fin.textContent = open ? "I'm done shopping" : "Done. Add receipt";
      fin.className = open ? "btn secondary wide" : "btn primary wide";
    }
    paintLeft(sess);
    paintChips(sess);
    try { qHuntUiSave(sess); } catch (e) { /* the hunt works without storage */ }
    if (!Q.plan && !ui.planTried && !offline() && typeof api === "function") {
      ui.planTried = true;
      api("/api/quest/plan").then(p => { if (p && !Q.plan) { Q.plan = p; if (Q.current === sess) paintChips(sess); } }).catch(() => {});
    }
  }
  function huntAfterGrab(sess, idx) {
    const it = sess && sess.items[idx];
    if (!it) return;
    // The sticker card carries its own Undo; two toasts would stack.
    if (window.AlbumUI && AlbumUI.cardOpen && AlbumUI.cardOpen()) return;
    const name = it.name;
    toast(`${name} in your cart`, { action: "Undo", onAction: () => {
      const j = sess.items.findIndex(i => i.name === name);
      if (j >= 0) putBackStop(j);
    } });
  }
  window.huntAfterRender = huntAfterRender;
  window.huntMoved = movedSheet;   // Express's Not here? opens the same sheet
  window.huntAfterGrab = huntAfterGrab;

  /* ------------------------------------------------------------------
   * Listeners.
   * ---------------------------------------------------------------- */
  function onSheetClick(ev) {
    if (ev.target.id === "hunt-sheet") { closeSheet(); return; }
    const b = ev.target.closest("[data-act]");
    if (b && ui.onAct) ui.onAct(b.dataset.act, b);
  }
  function onFinishCapture(ev) {
    const fin = ev.target.closest && ev.target.closest("#btn-finish, #exp-finish");
    if (fin && !fin.disabled) {
      const sess = Q.current;
      if (sess && openItems(sess).length) {
        ev.stopPropagation();
        ev.preventDefault();
        leaveSheet(fin);
        return;
      }
      return;                       // nothing open: the existing handler runs
    }
    const nh = ev.target.closest && ev.target.closest("#btn-nothere");
    if (nh) {
      ev.stopPropagation();
      ev.preventDefault();
      const sess = Q.current;
      if (!nh.disabled && sess) {
        const i = qCurrentIndex(sess);
        if (i >= 0) movedSheet(i, nh);
      }
    }
  }
  function onListClick(ev) {
    const m = ev.target.closest("[data-more]");
    if (m) { rowMenu(Number(m.dataset.more), m); return; }
    const f = ev.target.closest("[data-foundit]");
    if (f && !f.disabled) { foundIt(Number(f.dataset.foundit)); return; }
    const u = ev.target.closest("[data-unfind]");
    if (u) { unfind(Number(u.dataset.unfind)); return; }
    // A tap on the row (not its check or a button) opens the row menu,
    // the same as its chevron (design pass, 2026-10-29).
    if (ev.target.closest("button, a, input")) return;
    const r = ev.target.closest("[data-row]");
    if (r) {
      const chev = r.querySelector("[data-more]");
      rowMenu(Number(r.dataset.row), chev || r);
    }
  }
  function onLeftClick(ev) {
    const bar = ev.target.closest("[data-act='fold']");
    if (bar) {
      ui.leftOpen = !ui.leftOpen;
      paintLeft(Q.current);
      const again = document.querySelector("#hunt-left [data-act='fold']");
      if (again && again.focus) again.focus();
      return;
    }
    const back = ev.target.closest("[data-back]");
    if (back) bringBack(Number(back.dataset.back));
  }
  /* A sheet owns the keyboard: Esc closes it, and Space, Enter, the
   * arrows and P/F never reach the hunt hotkeys behind it. A key that
   * lands inside a sheet is stopped at the sheet (bubble), so the
   * sheet's own inputs and buttons still work. */
  function onKeyCapture(ev) {
    const spot = $("#spot-sheet");
    const spotOpen = !!spot && !spot.hidden;
    if (!sheetOpen() && !spotOpen) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (sheetOpen()) closeSheet(); else if (typeof closeSpotSheet === "function") closeSpotSheet();
      return;
    }
    if (ev.key === "Tab" && sheetOpen()) trapTab(ev);
    if (!inSheet(ev.target)) ev.stopPropagation();
  }
  function trapTab(ev) {
    const body = $("#hm-body");
    const els = body && body.querySelectorAll ? Array.from(body.querySelectorAll("button:not([disabled]), input, select, textarea")) : [];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    const cur = document.activeElement;
    if (!inSheet(cur)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }
  function wire() {
    const sheet = sheetEl();
    if (sheet) {
      sheet.addEventListener("click", onSheetClick);
      sheet.addEventListener("keydown", ev => ev.stopPropagation());
    }
    const spot = $("#spot-sheet");
    if (spot) spot.addEventListener("keydown", ev => ev.stopPropagation());
    const hv = $("#view-hunt"), ex = $("#view-express");
    if (hv) hv.addEventListener("click", onFinishCapture, true);
    if (ex) ex.addEventListener("click", onFinishCapture, true);
    const list = $("#hunt-list");
    if (list) list.addEventListener("click", onListClick);
    const left = $("#hunt-left");
    if (left) left.addEventListener("click", onLeftClick);
    document.addEventListener("keydown", onKeyCapture, true);
    wireForgot();
  }
  wire();

  window.Hunt = {
    huntSubstitutes, applyLeave, applyRestore, applyEdit, applyForgot,
    openItems, leaveSheet, movedSheet, rowMenu, swapSheet, editSheet,
    foundIt, forgotOne, submitForgot, bringBack, closeSheet,
    huntAfterRender, huntAfterGrab
  };
})();
