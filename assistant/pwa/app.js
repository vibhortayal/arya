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
  if (h.seen && h.seen.length) {
    $("#smart-list").innerHTML += h.seen.map(s =>
      `<p class="muted">Seen in the ${s.kind} · ${fmtShort(s.date)} — ${s.name} is in stock.</p>`).join("");
  }
  if (h.checks && h.checks.length) {
    $("#smart-list").innerHTML += h.checks.map(c =>
      `<p class="muted">${c.text}</p>`).join("");
  }
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
    <button class="secondary" id="btn-never">Never suggest</button>
    <button class="secondary" id="btn-expired">This expired</button></p>
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
  $("#btn-expired").addEventListener("click", async () => {
    await api(`/api/items/${encodeURIComponent(id)}/expired`, { method: "POST" });
    $("#flag-result").textContent = "Marked expired. It's on your list.";
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
  if (view === "view-scan") { renderScan().catch(showErr); renderEyes().catch(showErr); }
  if (view === "view-dash") renderDash().catch(showErr);
}
function showErr(e) { $("#asof").textContent = "Could not load: " + e.message; }

$("#btn-receipt").addEventListener("click", async () => {
  const out = $("#receipt-result");
  const file = $("#receipt-file").files[0];
  if (!file) { out.textContent = "Choose a receipt first — a PDF or a photo."; return; }
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) { out.textContent = "That file is not a PDF or a photo."; return; }
  out.textContent = "Reading…";
  try {
    const r = await fetch(isPdf ? "/decode/pdf" : "/decode/photo",
      { method: "POST", body: file, headers: { "Content-Type": file.type || (isPdf ? "application/pdf" : "image/jpeg") } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "That receipt could not be read.");
    const rec = data.receipt;
    const unchecked = (rec.lines || []).filter(l => l.status !== "auto").length;
    out.textContent = `${rec.merchant || "Receipt"} — total ${money(rec.total)} — ` +
      (rec.totals_reconcile ? "arithmetic verified" : "total did not reconcile") +
      (unchecked ? `; ${unchecked} line(s) to check below.` : ".");
    renderScan();
  } catch (e) {
    out.textContent = e.message;
  }
});

async function renderEyes() {
  const data = await api("/api/eyes").catch(() => ({ records: [] }));
  const box = $("#eyes-records");
  if (!box) return;
  box.innerHTML = data.records.map(rec => `
    <div class="eyes-record">
      <img src="/eyes/photos/${rec.id}" alt="Eyes photo" style="max-width:100%;border-radius:10px">
      <p class="muted">${rec.kind} · ${fmtDate(rec.date)}</p>
      ${rec.sightings.map((sg, i) => `
        <div class="row"><div><span class="name">${sg.name}</span>
        <span class="sub">${sg.judge_agree ? "" : "two reads disagreed · "}${sg.state}</span></div>
        ${sg.state === "pending" ? `<div>
          <button class="secondary eyes-confirm" data-rec="${rec.id}" data-idx="${i}">Yes, it's there</button>
          <button class="secondary eyes-reject" data-rec="${rec.id}" data-idx="${i}">Not there</button></div>` : ""}
        </div>`).join("")}
    </div>`).join("");
  box.querySelectorAll(".eyes-confirm, .eyes-reject").forEach(b =>
    b.addEventListener("click", async () => {
      const decision = b.classList.contains("eyes-confirm") ? "confirmed" : "rejected";
      await api(`/api/eyes/${b.dataset.rec}/sightings/${b.dataset.idx}`,
        { method: "POST", body: JSON.stringify({ state: decision }) });
      renderEyes();
    }));
}

$("#btn-eyes").addEventListener("click", async () => {
  const out = $("#eyes-result");
  const file = $("#eyes-file").files[0];
  if (!file) { out.textContent = "Choose a photo first."; return; }
  out.textContent = "Looking…";
  const kind = $("#eyes-kind").value;
  const r = await fetch(`/eyes/photo?kind=${encodeURIComponent(kind)}`,
    { method: "POST", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { out.textContent = data.detail || "That photo could not be read."; return; }
  out.textContent = `I see ${data.sightings.length} item(s). Confirm what is really there:`;
  renderEyes();
});

const chatHistory = [];
function chatLine(who, text) {
  const el = document.createElement("div");
  el.className = "row";
  el.innerHTML = `<div><span class="name">${who}</span><span class="sub" style="display:block">${text}</span></div>`;
  $("#chat-log").appendChild(el);
}
$("#chat-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chatHistory.push({ role: "user", content: text });
  chatLine("You", text);
  try {
    const res = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }) });
    chatHistory.push({ role: "assistant", content: res.reply });
    chatLine("Arya", res.reply);
    (res.applied || []).forEach(a => chatLine("Done", a));
    (res.skipped || []).forEach(a => chatLine("Note", a));
  } catch (e) {
    chatLine("Arya", "I could not answer that: " + e.message);
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

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
  $("#view-login").hidden = true;
  $("#app-main").hidden = false;
  $("#tabs").hidden = false;
  $("#userbar").hidden = false;
  $("#username").textContent = demo ? "demo" : user;
  $("#demobar").hidden = !demo;
  if (demo) {
    const card = $("#btn-receipt");
    if (card) { card.disabled = true; card.textContent = "Uploads are off in the demo"; }
  }
  show("view-home");
  refresh("view-home");
}
$("#signout").addEventListener("click", async ev => {
  ev.preventDefault();
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});
boot();
