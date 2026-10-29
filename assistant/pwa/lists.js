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
    const names = [];
    const same = (a, b) => (typeof qSameStore === "function" ? qSameStore(a, b) : a.toLowerCase() === b.toLowerCase());
    const add = n => {
      n = String(n || "").trim();
      if (n && !names.some(x => same(x, n))) names.push(n);
    };
    try { ((await api("/api/stores/mine")).stores || []).forEach(s => add(s.name)); } catch (e) { /* none yet */ }
    try {
      const plan = await api("/api/quest/plan");
      const seen = {};
      for (const i of plan.items || []) for (const [s, n] of Object.entries(i.stores || {})) seen[s] = (seen[s] || 0) + n;
      Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s]) => add(s));
    } catch (e) { /* no history yet */ }
    (extra || []).forEach(add);
    return names;
  }

  function storeRows(choices, picked) {
    if (!choices.length) return `<p class="sub">No stores yet. Add one in Profile, then link it here.</p>`;
    return choices.map(s => `<button class="navrow" type="button" data-ls-store="${esc(s)}" aria-pressed="${String(picked.includes(s))}">
      <span class="grow">${esc(s)}</span><span class="tick">✓</span></button>`).join("");
  }

  async function openNew() {
    const choices = await storeChoices();
    sheetState = { kind: "new", choices, picked: [] };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">New list</h3>
      <label class="field">Name<input type="text" id="ls-name" maxlength="40" placeholder="Costco, Indian Store, Party…" autocomplete="off"></label>
      <p class="sub">Link stores (optional). Pick as many as you like: a hunt from this list can start at any of them.</p>
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
    sheetState = { kind: "stores", id: l.id, picked: [...(l.stores || [])] };
    open(`<h3 id="ls-title" class="largetitle" style="font-size:22px">Link stores</h3>
      <p class="sub">Pick one or more. Hunts from ${esc(l.name)} can start at any of them.</p>
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
    else if (act === "create") guarded(create);
    else if (act === "saverename") guarded(saveRename);
    else if (act === "savestores") guarded(saveStores);
    else if (act === "stores" && l) guarded(() => openStores(l));
    else if (act === "delete" && l) guarded(() => del(l));
  });
  wrap.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { close(); return; }
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
