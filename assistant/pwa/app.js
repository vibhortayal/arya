"use strict";
const $ = s => document.querySelector(s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function fmtShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
function money(n) {
  return "$" + Math.abs(n).toFixed(2);
}
function qtyFmt(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}
function showErr(e) { toast("Could not load: " + e.message); }
function row(name, sub, right) {
  return `<div class="row"><div class="grow"><span class="name">${name}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div><div class="money">${right || ""}</div></div>`;
}
function empty(text) {
  return `<p class="empty">${text}</p>`;
}

let lastView = "view-home";
let listItems = {};
let isDemo = false;

/* ---------------- Home ---------------- */

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 10 18 19.5 6.5"/></svg>`;

function listRow(i) {
  const reason = [i.due_reason, i.judge_reason].filter(Boolean).join(" · ");
  return `<div class="row listrow${i.checked ? " checked" : ""}">
    <button class="check" data-act="check" data-id="${esc(i.item_id)}" aria-label="Check off ${esc(i.name)}">${CHECK_SVG}</button>
    <div class="grow"><a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a>
    ${reason ? `<span class="sub">${esc(reason)}</span>` : ""}</div>
    <div class="stepper">
      <button data-act="dec" data-id="${esc(i.item_id)}" aria-label="One less">−</button>
      <span class="qty">× ${qtyFmt(i.qty)}</span>
      <button data-act="inc" data-id="${esc(i.item_id)}" aria-label="One more">+</button>
    </div>
    <button class="remove" data-act="remove" data-id="${esc(i.item_id)}" aria-label="Remove ${esc(i.name)} from the list">×</button>
  </div>`;
}

function bindItemLinks(root) {
  if (!root) return;
  root.querySelectorAll(".item-link").forEach(a =>
    a.addEventListener("click", ev => { ev.preventDefault(); renderItem(a.dataset.id); }));
}

async function renderHome() {
  const h = await api("/api/home");
  $("#asof").textContent = h.as_of ? `As of ${fmtDate(h.as_of)}` : "";
  $("#running-low").innerHTML = h.running_low.length
    ? h.running_low.map(p => `<div class="row"><div class="grow"><a href="#" class="name item-link" data-id="${esc(p.item_id)}">${esc(p.name)}</a><span class="sub">${esc(p.due_window ? `around ${fmtShort(p.due_window[0])} – ${fmtShort(p.due_window[1])} · ${p.reason}` : p.reason)}${p.judge_reason ? ` · ${esc(p.judge_reason)}` : ""}</span></div></div>`).join("")
    : empty("Nothing is running low.");
  listItems = Object.fromEntries(h.list.items.map(i => [i.item_id, i]));
  $("#smart-list").innerHTML = h.list.items.length
    ? h.list.items.map(listRow).join("")
    : empty("The list is empty. Nothing is due yet.");
  let notes = "";
  if (h.seen && h.seen.length) {
    notes += h.seen.map(s => `<div class="row"><div class="grow"><span class="name">${esc(s.name)}</span><span class="sub">Seen in the ${esc(s.kind)} · ${fmtShort(s.date)} — in stock, left off the list.</span></div></div>`).join("");
  }
  if (h.checks && h.checks.length) {
    notes += h.checks.map(c => `<div class="row"><div class="grow"><span style="font-size:15px">${esc(c.text)}</span></div><div>
      <button class="chip" data-check-ok="${esc(c.item_id)}">Still good</button>
      <button class="chip" data-check-expired="${esc(c.item_id)}">It expired</button></div></div>`).join("");
  }
  $("#home-notes").innerHTML = notes ? `<h3 class="sect">Worth a look</h3><div class="group">${notes}</div>` : "";
  const c = h.cart;
  $("#cart").innerHTML =
    row(`${esc(c.store)} · ${c.items.length} items`, c.state === "approved" ? "Approved" : "Waiting for your approval",
        c.state === "approved" ? "" : `<button id="btn-approve" class="btn primary">Approve</button>`) +
    c.items.map(i => `<div class="row"><div class="grow"><span>${esc(i.name)}</span></div><div class="money">× ${qtyFmt(i.qty)}</div></div>`).join("") +
    `<p class="muted">Approving does not place an order. The cart is a list you take to the store.</p>`;
  const b = $("#btn-approve");
  if (b) b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await post("/api/cart/approve");
      toast("Cart approved. Nothing was ordered — the cart is a proposal.");
      renderHome();
    } catch (e) { toast(e.message); b.disabled = false; }
  });
  bindItemLinks($("#running-low"));
  bindItemLinks($("#smart-list"));
}

const SETUP_PROMPT = `You are connected to my Arya — my grocery assistant at https://arya-pilot.duckdns.org. Arya keeps a living model of my purchases, inventory and shopping list.

Your job when I talk to you:
- A receipt photo or PDF, or a pasted order (Instacart, Amazon, an email): read it and file it in Arya as structured data — merchant, date, each line (name, quantity, price, line total), subtotal, tax, total. Leave delivery fees and tips out. Report back the total Arya verified, never your own arithmetic.
- Questions about my list, my spending, or whether something expired: answer from Arya's data, not from memory of our chats.
- A fridge or pantry photo: file it as a sighting. Arya asks me to confirm any change.
- Anything else: answer normally. Bring Arya in only when my message is about my groceries, receipts, spending or list.

Rules: never guess a product name you cannot read — flag it and let Arya queue it for me. If a name is unknown, check the retailer's own online catalog, propose the match with its source, and wait for my word before settling it. Returns are refunds, never purchases.

My connector token lives in your secure credential store — the one I pasted when we set this up. Send it as a Bearer token and never print it.`;

document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-copy-prompt]");
  if (!b) return;
  if (navigator.clipboard) navigator.clipboard.writeText(SETUP_PROMPT);
  toast("Setup prompt copied.");
});

/* ---------------- Connector token (Profile + first run) ---------------- */

async function paintTokenRow(el) {
  if (!el) return;
  let has = false;
  try { has = (await api("/auth/token")).has_token; } catch (e) { el.innerHTML = ""; return; }
  el.innerHTML = `${has ? `<span class="sub grow">A connector token is active.</span>` : `<span class="sub grow">No token yet.</span>`}<button class="btn" data-mint="1">${has ? "Replace token" : "Create connector token"}</button>${has ? `<button class="btn danger" data-revoke="1">Revoke</button>` : ""}`;
}

async function mintInto(el) {
  try {
    const t = await post("/auth/token");
    el.innerHTML = `<input class="grow" data-token-value readonly value="${esc(t.token)}"><button class="btn" data-copy="1">Copy</button>
      <span class="sub">Copy it now — it is not shown again. Paste it into Muse's secure form.</span>`;
  } catch (e) { toast(e.message); }
}

document.addEventListener("click", async ev => {
  const rowEl = ev.target.closest("#profile-token-row, #connect-token-row");
  if (!rowEl) return;
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.mint) mintInto(rowEl);
  else if (b.dataset.copy) {
    const i = rowEl.querySelector("[data-token-value]"); i.select();
    if (navigator.clipboard) navigator.clipboard.writeText(i.value);
    toast("Token copied.");
  } else if (b.dataset.revoke) {
    try { await api("/auth/token", { method: "DELETE" }); toast("Connector token revoked."); paintTokenRow(rowEl); }
    catch (e) { toast(e.message); }
  }
});

/* ---------------- Profile ---------------- */

function paintThemeSeg() {
  const cur = localStorage.getItem("arya-theme") || "system";
  document.querySelectorAll("#theme-seg [data-theme-choice]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.themeChoice === cur)));
}

async function renderProfile() {
  $("#profile-account").innerHTML = row("Signed in as", "", esc(isDemo ? "demo" : (window.__aryaUser || "")));
  paintTokenRow($("#profile-token-row"));
  paintThemeSeg();
}

$("#theme-seg").addEventListener("click", ev => {
  const b = ev.target.closest("[data-theme-choice]");
  if (!b) return;
  localStorage.setItem("arya-theme", b.dataset.themeChoice);
  document.documentElement.dataset.theme = b.dataset.themeChoice;
  paintThemeSeg();
});

$("#btn-signout2").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});

/* ---------------- Add: intake status + Curator ---------------- */

async function renderIntake() {
  const el = $("#intake");
  if (!el) return;
  if (isDemo) {
    el.innerHTML = `<p class="muted nomargin">In the full app, data enters Arya through Muse: send a receipt photo, paste an online order, or send a fridge photo by chat or WhatsApp. The demo is read-only.</p>`;
    return;
  }
  let has = false;
  try { has = (await api("/auth/token")).has_token; } catch (e) { /* keep false */ }
  el.innerHTML = has
    ? `<p class="nomargin"><strong>Connected to Muse.</strong></p><p class="muted">Send a receipt photo, paste an online order, or send a fridge photo by chat or WhatsApp. Arya verifies every line; anything it cannot settle waits below.</p>`
    : `<p class="nomargin"><strong>Not connected yet.</strong></p><p class="muted">Connect Muse in Profile to file receipts and orders by chat or WhatsApp.</p>`;
}

async function renderCurator() {
  const el = $("#curator");
  if (!el) return;
  const d = await api("/api/curator").catch(() => ({ proposals: [] }));
  let html = d.proposals.map(p => `
    <div class="row"><div class="grow"><span class="name">${p.kind === "merge" ? `Merge into &ldquo;${esc(p.into_name)}&rdquo;` : `Keep &ldquo;${esc(p.names[0])}&rdquo; separate`}</span>
    <span class="sub">${p.names.map(esc).join(" + ")} — ${esc(p.reason)}</span></div></div>
    <div class="actions">
      <button class="chip" data-curator-apply="${esc(p.id)}">Apply</button>
      <button class="chip" data-curator-dismiss="${esc(p.id)}">Dismiss</button>
    </div>`).join("");
  html += `<div class="row"><span class="sub grow">The Curator reasons about which products are the same item. Nothing changes until you apply it.</span>${isDemo ? "" : `<button class="btn" id="btn-curator-run">Ask the Curator</button>`}</div>`;
  el.innerHTML = html;
}

$("#curator").addEventListener("click", async ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.id === "btn-curator-run") {
      b.disabled = true;
      const r = await post("/api/curator/run");
      toast(r.proposals ? `The Curator proposed ${r.proposals} change(s).` : "The Curator found nothing to change.");
      renderCurator();
    } else if (b.dataset.curatorApply) {
      await post("/api/curator/decide", { id: b.dataset.curatorApply, action: "apply" });
      toast("Applied. The products are one now.");
      renderCurator();
    } else if (b.dataset.curatorDismiss) {
      await post("/api/curator/decide", { id: b.dataset.curatorDismiss, action: "dismiss" });
      renderCurator();
    }
  } catch (e) { toast(e.message); }
});

/* ---------------- Scan + review ---------------- */

async function renderScan() {
  const q = await api("/api/review");
  let html = "";
  for (const l of q.lines) {
    const key = `${l.receipt_id}:${l.idx}`;
    html += `<div class="row"><div class="grow"><span class="name">${esc(l.decoded_name || l.raw)}</span>
      <span class="sub">Unverified · ${fmtDate(l.date)} · from “${esc(l.raw)}”</span></div></div>
      <div class="actions">
        <button class="chip" data-confirm="${esc(key)}">Looks right</button>
        ${l.suggested ? `<button class="chip" data-alt="${esc(key)}" data-name="${esc(l.suggested.name)}">Researched: ${esc(l.suggested.name)}</button>${l.suggested.source ? `<a class="sub" href="${esc(l.suggested.source)}" target="_blank" rel="noopener">source</a>` : ""}` : ""}
        ${(l.alternatives || []).map(a => `<button class="chip" data-alt="${esc(key)}" data-name="${esc(a)}">It is ${esc(a)}</button>`).join("")}
        <button class="chip" data-fix="${esc(key)}">Fix the name</button>
      </div>
      <div class="editor" data-editor="${esc(key)}" hidden>
        <input type="text" placeholder="Correct name" aria-label="Correct name">
        <button class="chip" data-save-line="${esc(key)}">Save</button>
      </div>`;
  }
  for (const u of q.unresolved) {
    const key = `u:${u.item_id}`;
    html += `<div class="row"><div class="grow"><span class="name">${esc(u.name)}</span>
      <span class="sub">Name not settled — kept off your list until you settle it</span></div></div>
      <div class="actions">
        ${(u.candidates || []).map(cn => `<button class="chip" data-resolve="${esc(u.item_id)}" data-name="${esc(cn)}">It is ${esc(cn)}</button>`).join("")}
        <button class="chip" data-fix="${esc(key)}">Set the name</button>
      </div>
      ${(u.sources && Object.keys(u.sources).length) ? `<div class="row"><span class="sub">Researched: ${Object.entries(u.sources).map(([n, u2]) => `<a href="${esc(u2)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}</span></div>` : ""}
      <div class="editor" data-editor="${esc(key)}" hidden>
        <input type="text" placeholder="Correct name" aria-label="Correct name">
        <button class="chip" data-save-resolve="${esc(u.item_id)}">Save</button>
      </div>`;
  }
  $("#review").innerHTML = html || empty("Nothing to review. Every line is verified.");
}

$("#review").addEventListener("click", async ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.confirm) {
      const [receipt_id, idx] = b.dataset.confirm.split(":");
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "confirm" });
      toast("Confirmed. It leaves the queue.");
      renderScan();
    } else if (b.dataset.alt) {
      const [receipt_id, idx] = b.dataset.alt.split(":");
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "rename", name: b.dataset.name });
      toast(`Set to ${b.dataset.name}. The dictionary learned it.`);
      renderScan();
    } else if (b.dataset.resolve) {
      await post("/api/review/resolve", { item_id: b.dataset.resolve, name: b.dataset.name });
      toast(`Settled as ${b.dataset.name}.`);
      renderScan();
    } else if (b.dataset.fix) {
      const ed = document.querySelector(`[data-editor="${CSS.escape(b.dataset.fix)}"]`);
      if (ed) { ed.hidden = !ed.hidden; const inp = ed.querySelector("input"); if (inp && !ed.hidden) inp.focus(); }
    } else if (b.dataset.saveLine) {
      const [receipt_id, idx] = b.dataset.saveLine.split(":");
      const ed = document.querySelector(`[data-editor="${CSS.escape(b.dataset.saveLine)}"]`);
      const name = ed.querySelector("input").value.trim();
      if (!name) { toast("Type the correct name first."); return; }
      await post("/api/review/line", { receipt_id, idx: Number(idx), action: "rename", name });
      toast(`Set to ${name}. The dictionary learned it.`);
      renderScan();
    } else if (b.dataset.saveResolve) {
      const ed = document.querySelector(`[data-editor="u:${CSS.escape(b.dataset.saveResolve)}"]`);
      const name = ed.querySelector("input").value.trim();
      if (!name) { toast("Type the correct name first."); return; }
      await post("/api/review/resolve", { item_id: b.dataset.saveResolve, name });
      toast(`Settled as ${name}.`);
      renderScan();
    }
  } catch (e) { toast(e.message); }
});

/* ---------------- Eyes ---------------- */

async function renderEyes() {
  const data = await api("/api/eyes").catch(() => ({ records: [] }));
  const box = $("#eyes-records");
  if (!box) return;
  box.innerHTML = data.records.map(rec => `
    <div class="eyes-record">
      <img src="/eyes/photos/${rec.id}" alt="Eyes photo">
      <p class="muted">${esc(rec.kind)} · ${fmtDate(rec.date)}</p>
      ${rec.sightings.map((sg, i) => `
        <div class="row"><div class="grow"><span class="name">${esc(sg.name)}</span>
        <span class="sub">${sg.judge_agree ? "" : "two reads disagreed · "}${esc(sg.state)}</span></div>
        ${sg.state === "pending" ? `<div>
          <button class="chip eyes-confirm" data-rec="${rec.id}" data-idx="${i}">Yes, it&rsquo;s there</button>
          <button class="chip eyes-reject" data-rec="${rec.id}" data-idx="${i}">Not there</button></div>` : ""}
        </div>`).join("")}
    </div>`).join("");
  box.querySelectorAll(".eyes-confirm, .eyes-reject").forEach(b =>
    b.addEventListener("click", async () => {
      const decision = b.classList.contains("eyes-confirm") ? "confirmed" : "rejected";
      try {
        await post(`/api/eyes/${b.dataset.rec}/sightings/${b.dataset.idx}`, { state: decision });
        renderEyes();
      } catch (e) { toast(e.message); }
    }));
}

/* ---------------- Dashboard ---------------- */

async function renderDash() {
  const d = await api("/api/dashboard");
  const monthKeys = Object.keys(d.spend_by_month).sort();
  const monthName = k => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  const period = monthKeys.length ? `${monthName(monthKeys[0])} – ${monthName(monthKeys[monthKeys.length - 1])}` : "";
  $("#dash-totals").innerHTML =
    (period ? `<p class="muted" style="padding-top:10px">${period} · after returns, item totals match the item pages</p>` : "") +
    row("Spend", "", money(d.spend_total)) +
    row("Returns", "", "−" + money(d.returns_total)) +
    row("Bought for others", "gifts and items for people outside the household", money(d.for_others_total)) +
    row("Trips", "", String(d.trip_count));
  const months = Object.entries(d.spend_by_month);
  const max = Math.max(...months.map(([, v]) => v), 1);
  $("#dash-months").innerHTML = months.map(([m, v]) =>
    `<div class="month-row"><span>${esc(monthName(m))}</span><div class="track"><div class="bar" style="width:${Math.round(v / max * 100)}%"></div></div><span class="money">${money(v)}</span></div>`).join("") || empty("No trips yet.");
  $("#dash-stores").innerHTML = Object.entries(d.spend_by_store)
    .sort((a, b) => b[1] - a[1]).map(([s, v]) => row(esc(s), "", money(v))).join("") || empty("No trips yet.");
  $("#dash-top").innerHTML = d.top_items.map(i =>
    `<div class="row"><div class="grow"><a href="#" class="name item-link" data-id="${esc(i.item_id)}">${esc(i.name)}</a></div><div class="money">${money(i.spend)}</div></div>`).join("") || empty("No items yet.");
  bindItemLinks($("#dash-top"));
}

/* ---------------- Item page ---------------- */

async function renderItem(id) {
  show("view-item");
  const d = await api(`/api/items/${encodeURIComponent(id)}`);
  const e = d.entry, p = d.pattern;
  let html = `<h2 class="largetitle" style="font-size:28px">${esc(e ? e.canonical_name : id)}</h2>`;
  if (p && p.history_state !== "not-enough-history") {
    html += `<div class="group">${row("Buys", "", String(p.purchase_count))}${row("Rhythm", "", `every ~${Math.round(p.median_interval_days)} days`)}${row("Last bought", "", fmtDate(p.last_bought))}${row("Total spend", "", money(p.total_spend))}</div>`;
  } else {
    html += `<p class="muted">Not enough history yet for a pattern.</p>`;
  }
  if (p && p.judge) {
    const onList = p.admitted;
    html += `<h3 class="sect">Why Arya ${onList ? "suggests it" : "leaves it off"}</h3><div class="group">` +
      row(esc(p.judge.class.replace("_", " ")), esc(p.judge.reason), onList ? "On the list" : "Off the list") + `</div>`;
  }
  if (p && p.analysis && p.analysis.verdict) {
    html += `<p class="muted">Pattern check: ${esc(p.analysis.verdict)}${p.analysis.seasonal_months ? ` · bought mostly in ${p.analysis.seasonal_months.map(m => MONTHS[m - 1]).join(", ")}` : ""}.</p>`;
  }
  const stores = Object.entries(d.price_by_store);
  if (stores.length) {
    html += `<h3 class="sect">Price by store</h3><div class="group">` + stores.map(([s, v]) =>
      row(esc(s), `${v.count} buys`, v.min === v.max ? money(v.min) : `${money(v.min)} – ${money(v.max)}`)).join("") + `</div>`;
  }
  if (d.history.length) {
    html += `<h3 class="sect">Recent history</h3><div class="group">` + d.history.slice(0, 10).map(h =>
      row(fmtDate(h.date), h.event_type === "return" ? "Returned" : esc(h.store_id || ""),
          `<span class="${h.event_type === "return" ? "return" : ""}">${h.event_type === "return" ? "−" : ""}${money(h.price)}</span>`)).join("") + `</div>`;
  }
  html += `<p style="margin-top:20px; display:flex; gap:8px; flex-wrap:wrap">
    <button class="btn secondary" id="btn-add">Add to list</button>
    <button class="btn secondary" id="btn-never">Never suggest</button>
    <button class="btn secondary" id="btn-expired">This expired</button></p>
    <p id="flag-result" class="muted"></p>`;
  $("#item-detail").innerHTML = html;
  $("#btn-add").addEventListener("click", async () => {
    try { await post("/api/list/add", { item_id: id }); $("#flag-result").textContent = "Added to your list."; }
    catch (e) { toast(e.message); }
  });
  $("#btn-never").addEventListener("click", async () => {
    try { await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: true }); $("#flag-result").textContent = "Arya will not suggest this again."; }
    catch (e) { toast(e.message); }
  });
  $("#btn-expired").addEventListener("click", async () => {
    try { await post(`/api/items/${encodeURIComponent(id)}/expired`); $("#flag-result").textContent = "Marked expired. It's on your list."; }
    catch (e) { toast(e.message); }
  });
}

/* ---------------- Navigation ---------------- */

function show(id) {
  document.querySelectorAll(".view").forEach(v => {
    v.hidden = v.id !== id;
    if (v.id === id) { v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); }
  });
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  if (id !== "view-item") lastView = id;
}
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => { show(b.dataset.view); refresh(b.dataset.view); }));
$("#item-back").addEventListener("click", ev => { ev.preventDefault(); show(lastView); refresh(lastView); });

function refresh(view) {
  if (view === "view-home") renderHome().catch(showErr);
  if (view === "view-scan") { renderIntake().catch(showErr); renderCurator().catch(showErr); renderScan().catch(showErr); renderEyes().catch(showErr); }
  if (view === "view-dash") renderDash().catch(showErr);
  if (view === "view-profile") renderProfile().catch(showErr);
}

/* ---------------- Ask Arya + voice ---------------- */

const chatHistory = [];
function chatLine(kind, text) {
  const el = document.createElement("div");
  el.className = "bubble " + kind;
  el.textContent = text;
  $("#chat-log").appendChild(el);
  el.scrollIntoView({ block: "end" });
}
let speakOn = localStorage.getItem("arya-speak") === "1";
function paintSpeak() {
  $("#btn-speak").classList.toggle("on", speakOn);
  $("#btn-speak").setAttribute("aria-pressed", String(speakOn));
}
$("#btn-speak").addEventListener("click", () => {
  speakOn = !speakOn;
  localStorage.setItem("arya-speak", speakOn ? "1" : "0");
  paintSpeak();
  if (!speakOn && "speechSynthesis" in window) speechSynthesis.cancel();
});
function speak(text) {
  if (!speakOn || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
$("#btn-mic").addEventListener("click", () => {
  const note = $("#voice-note");
  if (!SR) {
    note.hidden = false;
    note.textContent = "Voice input is not available in this browser. The microphone on your keyboard works too.";
    return;
  }
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = "en-US";
  recog.interimResults = true;
  const btn = $("#btn-mic");
  btn.classList.add("listening");
  recog.onresult = ev => {
    let finalText = "", interim = "";
    for (const res of ev.results) {
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    $("#chat-input").value = finalText || interim;
    if (finalText) $("#chat-form").requestSubmit();
  };
  recog.onend = () => { recog = null; btn.classList.remove("listening"); };
  recog.onerror = () => {
    note.hidden = false;
    note.textContent = "That did not come through. Try again, or type it.";
  };
  recog.start();
});
$("#chat-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chatHistory.push({ role: "user", content: text });
  chatLine("me", text);
  try {
    const res = await post("/api/chat", { messages: chatHistory });
    chatHistory.push({ role: "assistant", content: res.reply });
    chatLine("arya", res.reply);
    speak(res.reply);
    (res.applied || []).forEach(a => chatLine("sys", "Done: " + a));
    (res.skipped || []).forEach(a => chatLine("sys", a));
  } catch (e) {
    chatLine("arya", "I could not answer that: " + e.message);
  }
});

/* ---------------- Boot ---------------- */

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
paintSpeak();

async function boot() {
  const status = await api("/auth/status").catch(() => ({ has_users: true }));
  const me = await fetch("/auth/me").then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (me) {
    enterApp(me.user, me.demo);
    return;
  }
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-login"; });
  $("#login-title").textContent = status.has_users ? "Sign in" : "Create your account";
  $("#login-btn").textContent = status.has_users ? "Sign in" : "Create account";
  $("#login-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const body = JSON.stringify({ username: $("#login-user").value, password: $("#login-pass").value });
    const path = status.has_users ? "/auth/login" : "/auth/setup";
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) {
      $("#login-error").textContent = (await r.json().catch(() => ({}))).detail || "Sign-in failed.";
      return;
    }
    const data = await r.json();
    enterApp(data.user, false);
  });
  $("#demo-btn").addEventListener("click", async () => {
    const r = await fetch("/auth/demo", { method: "POST" });
    if (r.ok) enterApp("demo", true);
  });
}

function enterApp(user, demo) {
  isDemo = demo;
  window.__aryaUser = user;
  $("#view-login").hidden = true;
  $("#username").textContent = demo ? "demo" : user;
  $("#demobar").hidden = !demo;
  if (demo) {
    $("#chat-demo-note").hidden = false;
    $("#chat-input").disabled = true;
    $("#chat-send").disabled = true;
    $("#btn-mic").disabled = true;
    openShell();
    return;
  }
  api("/auth/token").then(t => {
    if (t.has_token) { openShell(); return; }
    // Connecting Muse is the first step of a new account.
    $("#view-connect").hidden = false;
    paintTokenRow($("#connect-token-row"));
    const finish = () => { $("#view-connect").hidden = true; openShell(); };
    $("#connect-done").onclick = finish;
    $("#connect-skip").onclick = finish;
  }).catch(() => openShell());
}

function openShell() {
  $("#app-main").hidden = false;
  $("#tabs").hidden = false;
  $("#userbar").hidden = false;
  show("view-home");
  refresh("view-home");
}
$("#signout").addEventListener("click", async ev => {
  ev.preventDefault();
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});
boot();
