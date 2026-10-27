"use strict";
const $ = s => document.querySelector(s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
function row(name, sub, right) {
  return `<div class="row"><div><span class="name">${name}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div><div class="money">${right || ""}</div></div>`;
}
function empty(text) {
  return `<p class="empty">${text}</p>`;
}

let lastView = "view-home";

async function renderHome() {
  const h = await api("/api/home");
  $("#asof").textContent = h.as_of ? `As of ${fmtDate(h.as_of)}` : "";
  $("#running-low").innerHTML = h.running_low.length
    ? h.running_low.map(p => row(p.name,
        p.due_window ? `around ${fmtShort(p.due_window[0])} – ${fmtShort(p.due_window[1])} · ${p.reason}` : p.reason,
        "")).join("")
    : empty("Nothing is running low.");
  $("#smart-list").innerHTML = h.list.items.length
    ? h.list.items.map(i => row(i.name, i.due_reason, `× ${i.qty}`)).join("")
    : empty("The list is empty. Nothing is due yet.");
  const c = h.cart;
  $("#cart").innerHTML =
    row(`${c.store} · ${c.items.length} items`, c.state === "approved" ? "Approved" : "Waiting for your approval",
        c.state === "approved" ? "" : `<button id="btn-approve">Approve</button>`);
  const b = $("#btn-approve");
  if (b) b.addEventListener("click", async () => {
    b.disabled = true;
    const cart = await api("/api/cart/approve", { method: "POST" });
    $("#cart").classList.add("fade");
    renderHome();
  });
}

async function renderScan() {
  const q = await api("/api/review");
  let html = "";
  for (const l of q.lines) {
    html += row(l.decoded_name || l.raw,
      `Unverified · ${fmtDate(l.date)}${l.alternatives && l.alternatives.length ? " · could be " + l.alternatives.join(" or ") : ""}`, "");
  }
  for (const u of q.unresolved) {
    html += row(u.name, `Name not settled${u.candidates.length ? " · could be " + u.candidates.join(" or ") : ""}`, "");
  }
  $("#review").innerHTML = html || empty("Nothing to review. Every line is verified.");
}

async function renderDash() {
  const d = await api("/api/dashboard");
  $("#dash-totals").innerHTML =
    row("Spend", "", money(d.spend_total)) +
    row("Returns", "", "−" + money(d.returns_total)) +
    row("Bought for others", "", money(d.for_others_total)) +
    row("Trips", "", String(d.trip_count));
  const months = Object.entries(d.spend_by_month);
  const max = Math.max(...months.map(([, v]) => v), 1);
  $("#dash-months").innerHTML = months.map(([m, v]) =>
    `<div class="month-row"><span>${m}</span><div class="bar" style="width:${Math.round(v / max * 100)}%"></div><span class="money">${money(v)}</span></div>`).join("") || empty("No trips yet.");
  $("#dash-stores").innerHTML = Object.entries(d.spend_by_store)
    .sort((a, b) => b[1] - a[1]).map(([s, v]) => row(s, "", money(v))).join("") || empty("No trips yet.");
  $("#dash-top").innerHTML = d.top_items.map(i =>
    `<div class="row"><div><a href="#" class="item-link" data-id="${i.item_id}"><span class="name">${i.name}</span></a></div><div class="money">${money(i.spend)}</div></div>`).join("") || empty("No items yet.");
  document.querySelectorAll(".item-link").forEach(a =>
    a.addEventListener("click", ev => { ev.preventDefault(); renderItem(a.dataset.id); }));
}

async function renderItem(id) {
  show("view-item");
  const d = await api(`/api/items/${encodeURIComponent(id)}`);
  const e = d.entry, p = d.pattern;
  let html = `<h2>${e ? e.canonical_name : id}</h2>`;
  if (p && p.history_state !== "not-enough-history") {
    html += `<p>${p.purchase_count} buys · about every ${Math.round(p.median_interval_days)} days · last bought ${fmtDate(p.last_bought)} · ${money(p.total_spend)} in total</p>`;
  } else {
    html += `<p class="muted">Not enough history yet for a pattern.</p>`;
  }
  const stores = Object.entries(d.price_by_store);
  if (stores.length) {
    html += "<h3>Price by store</h3>" + stores.map(([s, v]) =>
      row(s, `${v.count} buys`, `${money(v.min)} – ${money(v.max)}`)).join("");
  }
  if (d.history.length) {
    html += "<h3>History</h3>" + d.history.slice(0, 10).map(h =>
      row(fmtDate(h.date), h.event_type === "return" ? "Returned" : h.store_id || "",
          `<span class="${h.event_type === "return" ? "return" : ""}">${h.event_type === "return" ? "−" : ""}${money(h.price)}</span>`)).join("");
  }
  html += `<p style="margin-top:20px">
    <button class="secondary" id="btn-add">Add to list</button>
    <button class="secondary" id="btn-never">Never suggest</button></p>
    <p id="flag-result" class="muted"></p>`;
  $("#item-detail").innerHTML = html;
  $("#btn-add").addEventListener("click", async () => {
    await api(`/api/items/${encodeURIComponent(id)}/flag`, { method: "POST", body: JSON.stringify({ manual: true }) });
    $("#flag-result").textContent = "Added to your list.";
  });
  $("#btn-never").addEventListener("click", async () => {
    await api(`/api/items/${encodeURIComponent(id)}/flag`, { method: "POST", body: JSON.stringify({ never: true }) });
    $("#flag-result").textContent = "Arya will not suggest this again.";
  });
}

function show(id) {
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== id; });
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  if (id !== "view-item") lastView = id;
}
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => { show(b.dataset.view); refresh(b.dataset.view); }));
$("#item-back").addEventListener("click", ev => { ev.preventDefault(); show(lastView); refresh(lastView); });

function refresh(view) {
  if (view === "view-home") renderHome().catch(showErr);
  if (view === "view-scan") renderScan().catch(showErr);
  if (view === "view-dash") renderDash().catch(showErr);
}
function showErr(e) { $("#asof").textContent = "Could not load: " + e.message; }

$("#file-json").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  const data = JSON.parse(await f.text());
  const isList = Array.isArray(data);
  const res = await api(isList ? "/import/costco-json-bulk" : "/import/costco-json",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  $("#import-result").textContent = isList
    ? `Imported. ${res.added} new receipts (${res.total_receipts} total).`
    : `Imported. Totals ${res.totals_reconcile ? "verified" : "did not reconcile — flagged for review"}.`;
  renderScan();
});
$("#btn-decode").addEventListener("click", async () => {
  const text = $("#receipt-text").value.trim();
  if (!text) return;
  try {
    const res = await api("/decode/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    $("#decode-result").textContent = `Decoded ${res.lines.length} lines. Totals ${res.totals_reconcile ? "verified" : "did not reconcile — flagged for review"}.`;
  } catch (e) {
    $("#decode-result").textContent = e.message;
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
refresh("view-home");
