/* Named lists: create, rename, link stores, delete with Undo, move
 * items between lists, and "why this suggestion" (owner, 2026-10-29;
 * List overhaul wireframe v1). The Lists view itself (cards, rows,
 * suggestions) is painted by app.js; this file owns the sheets and the
 * writes. Item rows stay one list at a time: the server keeps the list
 * id on the item's flag, so deleting a list never deletes items. */

(function () {
  const wrap = $("#list-sheet"), body = $("#ls-body");
  let sheetState = null;   // what the open sheet is doing
  const WHY_ICONS = {
    cal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.6"/></svg>` };

  function open(html) {
    body.innerHTML = `<span class="sheetgrip"></span>${html}`;
    wrap.hidden = false;
    const f = body.querySelector("input[type=text]");
    if (f) { f.focus(); f.select(); }
  }
  function close() { wrap.hidden = true; sheetState = null; body.innerHTML = ""; }

  /* Stores a list may link to: the ones the household already has
   * (My Stores first, then the stores its receipts name), so a hunt
   * from the list can open the store picker with no typing. */
  async function storeChoices(extra) {
    const rows = [];   // { name, id?, where? } — id only for My Stores rows
    const same = (a, b) => (typeof qSameStore === "function" ? qSameStore(a, b) : a.toLowerCase() === b.toLowerCase());
    const add = (n, id, where) => {
      n = String(n || "").trim();
      if (n && !rows.some(x => (id && x.id === id) || (!id && same(x.name, n)))) rows.push({ name: n, id: id || "", where: where || "" });
    };
    try { ((await api("/api/stores/mine")).stores || []).forEach(s => add(s.name, s.id, storeWhere(s))); } catch (e) { /* none yet */ }
    try {
      const plan = await api("/api/quest/plan");
      const seen = {};
      for (const i of plan.items || []) for (const [s, n] of Object.entries(i.stores || {})) seen[s] = (seen[s] || 0) + n;
      Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s]) => add(s));
    } catch (e) { /* no history yet */ }
    (extra || []).forEach(n => add(n));
    return rows;
  }

  function storeWhere(s) {
    return [s.street, s.city].filter(Boolean).join(", ");
  }

  function storeRows(choices, picked) {
    if (!choices.length) return `<p class="sub">No stores yet. Find one above, then tick it.</p>`;
    return choices.map(c => `<div class="srow"><button class="navrow" type="button" data-ls-store="${esc(c.name)}" aria-pressed="${String(picked.includes(c.name))}">
      <span class="grow">${esc(c.name)}${c.fresh ? `<span class="newtag">NEW</span>` : ""}${c.where ? `<small>${esc(c.where)}</small>` : ""}</span><span class="tick">✓</span></button>${c.id
        ? `<button class="rmstore" type="button" data-ls-rm="${esc(c.id)}" aria-label="Remove ${esc(c.name)} from my stores">Remove</button>` : ""}</div>`).join("");
  }

  /* Find a store: the same Google Places picker as Hunt and
   * Profile > Stores (autocomplete, then a pick that files the store
   * in the directory and in My Stores). Suggestions sit in flow. */
  let placesTimer = null, placesSession = "", geo = null;
  const session = () => placesSession || (placesSession = `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`);
  function findBlock() {
    return `<div class="findrow"><input type="text" id="ls-find" maxlength="80" placeholder="Find a store (name or ZIP)" autocomplete="off" aria-label="Find a store"><button class="chip" type="button" data-ls="near">📍 Near me</button></div>
      <div id="ls-goog" class="gdrop" hidden></div>`;
  }
  function paintStores() {
    $("#ls-stores").innerHTML = storeRows(sheetState.choices, sheetState.picked);
  }
  function paintSuggestions(d, head) {
    const box = $("#ls-goog");
    if (!box) return;
    const rows = d.suggestions || [];
    if (!rows.length) {
      box.innerHTML = d.provisioned === false
        ? `<div class="ghead">Google search is not set up</div>`
        : `<div class="ghead">No stores found</div>`;
      box.hidden = false;
      return;
    }
    box.innerHTML = `<div class="ghead">${head}</div>` + rows.map(r => `
      <button class="gitem" type="button" data-ls-pick="${esc(r.place_id)}" data-ls-pname="${esc(r.name)}">
        <span class="name">${esc(r.name)}</span><span class="sub">${esc(r.secondary)}</span>
      </button>`).join("");
    box.hidden = false;
  }
  function clearSuggestions() {
    const box = $("#ls-goog");
    if (box) { box.hidden = true; box.innerHTML = ""; }
  }
  async function suggest(q) {
    const g = geo ? `&lat=${geo.lat}&lng=${geo.lng}` : "";
    const d = await api(`/api/stores/places?q=${encodeURIComponent(q)}&session=${session()}${g}`);
    if (!sheetState || ($("#ls-find") && $("#ls-find").value.trim() !== q)) return;   // typed on: stale
    paintSuggestions(d, "From Google");
  }
  function nearMe() {
    if (!navigator.geolocation) { toast("This device cannot share its location."); return; }
    navigator.geolocation.getCurrentPosition(p => guarded(async () => {
      geo = { lat: p.coords.latitude, lng: p.coords.longitude };
      const d = await api(`/api/stores/places?q=&lat=${geo.lat}&lng=${geo.lng}`);
      if (!sheetState) return;
      paintSuggestions(d, "Near you");
    }), () => toast("Allow location to find stores near you, or type a name."), { timeout: 8000 });
  }
  async function pickPlace(btn) {
    btn.disabled = true;
    try {
      const row = await post("/api/stores/places/pick", { place_id: btn.dataset.lsPick, name: btn.dataset.lsPname });
      placesSession = "";   // the pick ends Google's billing session
      if (!sheetState || !sheetState.choices) return;
      const at = sheetState.choices.findIndex(c => c.id === row.id);
      if (at > -1) sheetState.choices.splice(at, 1);
      sheetState.choices.unshift({ name: row.name, id: row.id, where: storeWhere(row), fresh: true });
      if (!sheetState.picked.includes(row.name)) sheetState.picked.push(row.name);
      $("#ls-find").value = "";
      clearSuggestions();
      paintStores();
      toast(`${row.name} is in your stores.`);
    } catch (e) { toast(e.message); btn.disabled = false; }
  }
  async function removeStore(id) {
    await post("/api/stores/mine/remove", { store_id: id });
    if (!sheetState || !sheetState.choices) return;
    const c = sheetState.choices.find(x => x.id === id);
    sheetState.choices = sheetState.choices.filter(x => x.id !== id);
    if (c) sheetState.picked = sheetState.picked.filter(n => n !== c.name);
    paintStores();
    toast(c ? `Removed ${c.name} from your stores.` : "Removed.");
  }

  async function openNew(moving) {
    const choices = await storeChoices();
    sheetState = { kind: "new", choices, picked: [], moving: moving || null };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">New list</h3>
      <label class="field">Name<input type="text" id="ls-name" maxlength="40" placeholder="Costco, Indian Store, Party…" autocomplete="off"></label>
      <p class="sub">Link stores (optional). Find one, or pick from yours. A hunt from this list can start at any of them.</p>
      ${findBlock()}
      <div id="ls-stores">${storeRows(choices, [])}</div>
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="close">Cancel</button><button class="btn primary" type="button" data-ls="create">Create list</button></div>`);
  }

  // Rename in place (owner, 2026-10-29): the title becomes a field and
  // Select becomes Save. Enter saves, Escape puts the name back.
  function startRename() {
    const l = lensList();
    if (!l || listSel) return;
    listRenaming = true;
    $("#lp-title").innerHTML = `<input type="text" id="lp-name-input" class="titleinput" maxlength="40" value="${esc(l.name)}" autocomplete="off" aria-label="List name">`;
    paintListPage();
    const f = $("#lp-name-input");
    f.focus(); f.select();
    f.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); guarded(saveTitle); }
      else if (ev.key === "Escape") { ev.preventDefault(); stopRename(); }
    });
  }

  function stopRename() { listRenaming = false; paintListPage(); }

  async function saveTitle() {
    const l = lensList(), f = $("#lp-name-input");
    if (!l || !f) { stopRename(); return; }
    const name = f.value.trim();
    if (!name) { toast("Give the list a name."); f.focus(); return; }
    if (name !== l.name) await post("/api/lists/update", { id: l.id, name });
    listRenaming = false;
    await renderList();
  }

  function openMenu(l) {
    sheetState = { kind: "menu", id: l ? l.id : null };
    const n = l ? listData.list.items.filter(i => i.on_list && i.list === l.id).length : 0;
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">${esc(l ? l.name : "Everything else")}</h3>
      ${l ? `<button class="navrow" type="button" data-ls="stores"><span class="grow">${(l.stores || []).length ? "Change stores" : "Link stores"}<small>${(l.stores || []).length ? esc(l.stores.join(", ")) : "Suggestions and hunts use them"}</small></span><span class="chev">›</span></button>` : ""}
      ${l ? `<button class="navrow dangerrow" type="button" data-ls="delete"><span class="grow">Delete list<small>${n ? `Its ${n} item${n === 1 ? "" : "s"} move to Everything else` : "It has no items"}</small></span></button>` : ""}
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="close">Done</button></div>`);
  }

  async function openStores(l) {
    const choices = await storeChoices(l.stores);
    sheetState = { kind: "stores", id: l.id, choices, picked: [...(l.stores || [])] };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">Link stores</h3>
      <p class="sub">Pick one or more. Hunts from ${esc(l.name)} can start at any of them.</p>
      ${findBlock()}
      <div id="ls-stores">${storeRows(choices, sheetState.picked)}</div>
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="close">Cancel</button><button class="btn primary" type="button" data-ls="savestores">Save</button></div>`);
  }

  /* Move one or several items to another list (swipe → Move, or
   * Select → Move to…). The current list shows as "here now". */
  function openMove(ids) {
    const here = listLens === "home" ? "else" : listLens;
    sheetState = { kind: "move", ids };
    const count = id => listData.list.items.filter(i => i.on_list && !i.checked && (id === "else"
      ? !namedLists().some(l => l.id === i.list) : i.list === id)).length;
    const one = ids.length === 1 ? (listItems[ids[0]] || {}).name : "";
    const dest = (id, name) => id === here
      ? `<button class="navrow here" type="button" disabled><span class="grow">${esc(name)}<small>${ids.length === 1 ? "It's" : "They're"} here now</small></span></button>`
      : `<button class="navrow" type="button" data-ls-move="${esc(id)}"><span class="grow">${esc(name)}<small>${count(id)} item${count(id) === 1 ? "" : "s"}</small></span><span class="chev">›</span></button>`;
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">Move ${one ? esc(one) : `${ids.length} items`} to</h3>
      ${namedLists().map(l => dest(l.id, l.name)).join("")}${dest("else", "Everything else")}
      <button class="navrow accentrow" type="button" data-ls="movenew"><span class="grow">+ New list…</span></button>`);
  }

  async function moveTo(ids, listId) {
    const back = ids.map(id => [id, (listItems[id] || {}).list || null]);
    for (const id of ids) await post("/api/list/move", { item_id: id, list_id: listId === "else" ? null : listId });
    close();
    listSel = null;
    await renderList();
    const name = listId === "else" ? "Everything else" : (namedLists().find(l => l.id === listId) || {}).name;
    const what = ids.length === 1 ? ((listItems[ids[0]] || {}).name || "Item") : `${ids.length} items`;
    toast(`Moved ${what} to ${name}.`, { action: "Undo", onAction: () => guarded(async () => {
      for (const [id, l] of back) await post("/api/list/move", { item_id: id, list_id: l });
      await renderList();
    }) });
  }

  /* Why Arya suggests an item: rhythm (with the last 8 weeks as dots),
   * last bought, and where it is usually bought, all from receipts. */
  async function openWhy(itemId) {
    const it = listItems[itemId];
    if (!it) return;
    const target = suggestHome(it);
    const tname = target === "else" ? "your list" : (namedLists().find(l => l.id === target) || {}).name;
    let d = null;
    try { d = await api(`/api/items/${encodeURIComponent(itemId)}`); } catch (e) { d = null; }
    const p = d && d.pattern;
    const hist = ((d && d.history) || []).filter(h => h.event_type === "purchase");
    const rows = [];
    const ic = k => `<span class="ic" aria-hidden="true">${WHY_ICONS[k]}</span>`;
    if (it.expired_on) rows.push(`<div class="whyrow">${ic("clock")}<div><b>You marked it expired</b><span class="sub">On ${esc(fmtShort(it.expired_on))}.</span></div></div>`);
    if (p && p.median_interval_days) {
      const now = new Date(), day = 864e5;
      const dots = [];
      for (let w = 7; w >= 0; w--) {
        const hi = now - w * 7 * day, lo = hi - 7 * day;
        const got = hist.some(h => { const t = new Date(h.date + "T12:00:00"); return t > lo && t <= hi; });
        dots.push(w === 0 && !got ? `<i class="now"></i>` : `<i class="${got ? "" : "gap"}"></i>`);
      }
      const first = hist.length ? hist[hist.length - 1].date : null;
      rows.push(`<div class="whyrow">${ic("cal")}<div><b>You buy it every ~${Math.round(p.median_interval_days)} days</b><span class="sub">${p.purchase_count} time${p.purchase_count === 1 ? "" : "s"}${first ? ` since ${esc(MONTHS[Number(first.slice(5, 7)) - 1])}` : ""}. Last 8 weeks:</span><span class="dots" aria-hidden="true">${dots.join("")}</span></div></div>`);
    }
    if (p && p.last_bought) {
      const last = hist[0];
      const late = (p.days_since_last || 0) - Math.round(p.median_interval_days || 0);
      rows.push(`<div class="whyrow">${ic("clock")}<div><b>Last bought ${p.days_since_last === 0 ? "today" : `${p.days_since_last} day${p.days_since_last === 1 ? "" : "s"} ago`}</b><span class="sub">${esc(fmtShort(p.last_bought))}${last && last.store_id ? ` at ${esc(last.store_id)}` : ""}.${late > 0 ? ` That's ${late} day${late === 1 ? "" : "s"} past your usual.` : ""}</span></div></div>`);
    }
    const stores = Object.entries((d && d.price_by_store) || {}).sort((a, b) => b[1].count - a[1].count);
    if (stores.length) {
      const [s0, v0] = stores[0];
      const others = stores.slice(1, 3).map(([s, v]) => `${money(v.median)} at ${esc(s)}`).join(" · ");
      rows.push(`<div class="whyrow">${ic("tag")}<div><b>Usually from ${esc(s0)}, ${money(v0.median)}</b><span class="sub">${others || `${v0.count} buy${v0.count === 1 ? "" : "s"} there`}</span></div></div>`);
    }
    if (!rows.length) rows.push(`<div class="whyrow">${ic("cal")}<div><b>${esc(suggestWhy(it))}</b>${it.judge_reason ? `<span class="sub">${esc(it.judge_reason)}</span>` : ""}</div></div>`);
    const c = charFor(it.name);
    sheetState = { kind: "why", id: itemId, target };
    open(`<div class="whyhead">${c ? `<img class="popface" src="assets/characters/${c}" alt="">` : ""}<div><h3 id="ls-title" class="largetitle" style="font-size:22px;margin:0">${esc(it.name)}</h3><span class="sub">Why Arya suggests it${target === "else" ? "" : ` for ${esc(tname)}`}</span></div></div>
      ${rows.join("")}
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="whynot">Not now</button><button class="btn primary" type="button" data-ls="whyadd">${tname.length <= 10 ? `Add to ${esc(tname)}` : "Add to list"}</button></div>
      <p class="nomargin whynever"><button class="linkbtn" type="button" data-ls="whynever">Never suggest this</button></p>`);
  }

  async function guarded(fn) {
    try { await fn(); } catch (e) { toast(e.message); }
  }

  async function create() {
    const name = $("#ls-name").value.trim();
    if (!name) { toast("Give the list a name."); return; }
    const moving = sheetState.moving;
    const l = await post("/api/lists", { name, stores: sheetState.picked });
    if (moving) { await renderList(); await moveTo(moving, l.id); return; }
    close();
    listLens = l.id;
    await renderList();
    toast(`Created ${l.name}.`);
  }

  async function saveStores() {
    const id = sheetState.id;
    await post("/api/lists/update", { id, stores: sheetState.picked });
    close();
    await renderList();
  }

  async function del(l) {
    const out = await post("/api/lists/delete", { id: l.id });
    close();
    listLens = "home";
    await renderList();
    toast(`Deleted ${l.name}.`, { action: "Undo", onAction: () => guarded(async () => {
      await post("/api/lists/restore", { list: out.deleted, index: out.index });
      listLens = l.id;
      await renderList();
    }) });
  }

  wrap.addEventListener("click", ev => {
    if (ev.target === wrap) { close(); return; }
    const st = ev.target.closest("[data-ls-store]");
    if (st && sheetState && sheetState.picked) {
      const s = st.dataset.lsStore, p = sheetState.picked;
      if (p.includes(s)) p.splice(p.indexOf(s), 1); else p.push(s);
      st.setAttribute("aria-pressed", String(p.includes(s)));
      return;
    }
    const pk = ev.target.closest("[data-ls-pick]");
    if (pk && sheetState && sheetState.picked) { pickPlace(pk); return; }
    const rm = ev.target.closest("[data-ls-rm]");
    if (rm && sheetState && sheetState.choices) { guarded(() => removeStore(rm.dataset.lsRm)); return; }
    const mv = ev.target.closest("[data-ls-move]");
    if (mv && sheetState && sheetState.kind === "move") {
      const ids = sheetState.ids;
      guarded(() => moveTo(ids, mv.dataset.lsMove));
      return;
    }
    const b = ev.target.closest("[data-ls]");
    if (!b) return;
    const act = b.dataset.ls, l = lensList();
    if (act === "close") close();
    else if (act === "near") nearMe();
    else if (act === "movenew" && sheetState) { const ids = sheetState.ids; guarded(() => openNew(ids)); }
    else if (act === "whyadd" && sheetState) { const id = sheetState.id; close(); addSuggestion(id); }
    else if (act === "whynot" && sheetState) { const id = sheetState.id; close(); guarded(() => dismissSuggestion(id)); }
    else if (act === "whynever" && sheetState) { const id = sheetState.id; close(); guarded(() => neverSuggest(id)); }
    else if (act === "create") guarded(create);
    else if (act === "savestores") guarded(saveStores);
    else if (act === "stores" && l) guarded(() => openStores(l));
    else if (act === "delete" && l) guarded(() => del(l));
  });
  wrap.addEventListener("input", ev => {
    if (ev.target.id !== "ls-find") return;
    clearTimeout(placesTimer);
    const q = ev.target.value.trim();
    if (q.length < 3) { clearSuggestions(); return; }
    placesTimer = setTimeout(() => suggest(q).catch(() => clearSuggestions()), 300);
  });
  wrap.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { close(); return; }
    if (ev.key === "Enter" && ev.target.id === "ls-find") { ev.preventDefault(); return; }
    if (ev.key === "Enter" && ev.target.id === "ls-name") {
      ev.preventDefault();
      guarded(create);
    }
  });

  $("#list-new").addEventListener("click", () => guarded(() => openNew()));
  $("#lp-menu").addEventListener("click", () => openMenu(lensList()));
  $("#lp-title").addEventListener("click", ev => { if (ev.target.closest("#lp-pen")) startRename(); });

  async function dismissSuggestion(id) {
    const it = listItems[id];
    await post("/api/list/remove", { item_id: id });
    await renderList();
    toast(`Skipped ${it ? it.name : "it"} for now.`, { action: "Undo", onAction: () => guarded(async () => {
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { dismissed_on: null, manual: false });
      await renderList();
    }) });
  }

  async function neverSuggest(id) {
    const it = listItems[id];
    await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: true });
    await renderList();
    toast(`Arya won't suggest ${it ? it.name : "it"} again.`, { action: "Undo", onAction: () => guarded(async () => {
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: false });
      await renderList();
    }) });
  }

  window.ListSheets = { openMove, openWhy, saveTitle };
})();
