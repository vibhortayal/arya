/* Named lists: create, rename, link stores, delete with Undo, file an
 * item under a list, and start a hunt from a list (owner, 2026-10-29;
 * wireframe v9). The List view itself (chips, groups, header) is
 * painted by app.js; this file owns the sheets and the writes. Item
 * rows stay one list at a time: the server keeps the list id on the
 * item's flag, so deleting a list never deletes items. */

(function () {
  const wrap = $("#list-sheet"), body = $("#ls-body");
  let sheetState = null;   // what the open sheet is doing

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

  async function openNew() {
    const choices = await storeChoices();
    sheetState = { kind: "new", choices, picked: [] };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">New list</h3>
      <label class="field">Name<input type="text" id="ls-name" maxlength="40" placeholder="Costco, Indian Store, Party…" autocomplete="off"></label>
      <p class="sub">Link stores (optional). Find one, or pick from yours. A hunt from this list can start at any of them.</p>
      ${findBlock()}
      <div id="ls-stores">${storeRows(choices, [])}</div>
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="close">Cancel</button><button class="btn primary" type="button" data-ls="create">Create list</button></div>`);
  }

  async function openRename(l) {
    sheetState = { kind: "rename", id: l.id };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">Rename list</h3>
      <label class="field">Name<input type="text" id="ls-name" maxlength="40" value="${esc(l.name)}" autocomplete="off"></label>
      <div class="sheetacts"><button class="btn secondary" type="button" data-ls="close">Cancel</button><button class="btn primary" type="button" data-ls="saverename">Save</button></div>`);
  }

  function openMenu(l) {
    sheetState = { kind: "menu", id: l.id };
    const n = listData.list.items.filter(i => i.list === l.id).length;
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">${esc(l.name)}</h3>
      <button class="navrow" type="button" data-ls="stores"><span class="grow">${(l.stores || []).length ? "Change stores" : "Link stores"}<small>${(l.stores || []).length ? esc(l.stores.join(", ")) : "Optional, for hunts"}</small></span><span class="chev">›</span></button>
      <button class="navrow dangerrow" type="button" data-ls="delete"><span class="grow">Delete list<small>${n ? `Its ${n} item${n === 1 ? "" : "s"} move to Everything else` : "It has no items"}</small></span></button>
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

  function openFile(itemId) {
    const it = listItems[itemId];
    sheetState = { kind: "file", id: itemId };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">File ${esc(it ? it.name : "item")}</h3>
      <p class="sub">Pick the list it belongs on.</p>
      ${namedLists().map(l => `<button class="navrow" type="button" data-ls-file="${esc(l.id)}" aria-pressed="${String(it && it.list === l.id)}"><span class="grow">${esc(l.name)}</span><span class="tick">✓</span></button>`).join("")}`);
  }

  async function guarded(fn) {
    try { await fn(); } catch (e) { toast(e.message); }
  }

  async function create() {
    const name = $("#ls-name").value.trim();
    if (!name) { toast("Give the list a name."); return; }
    const l = await post("/api/lists", { name, stores: sheetState.picked });
    close();
    listLens = l.id;
    await renderList();
    toast(`Created ${l.name}.`);
  }

  async function saveRename() {
    const name = $("#ls-name").value.trim();
    if (!name) { toast("Give the list a name."); return; }
    const id = sheetState.id;
    await post("/api/lists/update", { id, name });
    close();
    await renderList();
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
    listLens = "all";
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
    const fl = ev.target.closest("[data-ls-file]");
    if (fl && sheetState && sheetState.kind === "file") {
      const id = sheetState.id;
      guarded(async () => {
        await post("/api/list/move", { item_id: id, list_id: fl.dataset.lsFile });
        close();
        await renderList();
        toast("Filed.");
      });
      return;
    }
    const b = ev.target.closest("[data-ls]");
    if (!b) return;
    const act = b.dataset.ls, l = lensList();
    if (act === "close") close();
    else if (act === "near") nearMe();
    else if (act === "create") guarded(create);
    else if (act === "saverename") guarded(saveRename);
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
      guarded(sheetState && sheetState.kind === "rename" ? saveRename : create);
    }
  });

  $("#list-new").addEventListener("click", () => guarded(openNew));

  /* The header buttons and each row's "File under" are painted by
   * app.js into #smart-list; one delegation here. */
  $("#smart-list").addEventListener("click", ev => {
    const b = ev.target.closest("[data-list-act]");
    if (!b) return;
    const act = b.dataset.listAct, l = lensList();
    if (act === "rename" && l) openRename(l);
    else if (act === "menu" && l) openMenu(l);
    else if (act === "file") openFile(b.dataset.id);
    else if (act === "hunt" && l) {
      if (typeof startHuntFromList === "function") startHuntFromList(l);
    }
  });
})();
