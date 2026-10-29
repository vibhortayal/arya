/* Arya's powers, the daily "Did you know?" card, the (i) info sheets
 * and the price cards in Analysis (owner, 2026-10-29; price
 * intelligence wireframe approved the same day).
 *
 * Rules the owner set: every price comes from the household's own
 * receipts, or later from households that opt in; never from a store
 * site, a flyer, an API or the web. Cards say one fact; how it was
 * worked out and its limits sit behind the (i) button and show only
 * when tapped. No line graphs. Quest is not listed here. */

(function () {
  const wrap = $("#info-sheet"), body = $("#info-body");
  let facts = { receipts: 0, stores: 0, share_prices: false };

  /* What each (i) says: how the number is worked out, and its limits. */
  const INFO = {
    trend: { t: "Price trend", s: "How Arya works out a price move.", rows: [
      ["From your receipts", "Arya compares the first and the latest price you paid at the store you use most for this item."],
      ["What counts", "Sale prices count as what you paid. A trend needs 3 or more buys over 4 weeks or more. Moves under 2% are not shown."],
      ["What it is not", "This is your price, not an official inflation number."]] },
    cheaper: { t: "Cheaper store", s: "How Arya picks the cheaper store.", rows: [
      ["From your receipts", "The last price you paid at each store for this same item."],
      ["What counts", "A store counts as cheaper only when it saves at least 25 cents and 5%."],
      ["What it is not", "Prices change. This is what you paid, not today's shelf price."]] },
    similar: { t: "Similar items", s: "Where these come from.", rows: [
      ["From your receipts", "Other items you bought with the same kind of name, such as other milks."],
      ["Per ounce", "When both names give a size, Arya shows the price per ounce so they compare fairly."],
      ["No outside prices", "Arya never looks up prices on store sites, flyers or the web."]] },
    basket: { t: "Your prices", s: "How Arya works out your own inflation.", rows: [
      ["Same items", "Items you bought both then (60 to 120 days ago) and now (the last 30 days). Each item counts once."],
      ["Dollars a month", "Each item is weighed by how often you bought it in the last 3 months."],
      ["What it is not", "Your own prices at your own stores, not an official inflation number."]] },
    split: { t: "Split smarter", s: "How Arya finds the saving.", rows: [
      ["From your receipts", "Your last 6 months. An item counts when you bought it at 2 or more stores."],
      ["What counts", "The other store must save at least 25 cents and 5% on that item."],
      ["What it leaves out", "Travel time and gas are not counted."]] },
    waste: { t: "Food that expired", s: "How Arya counts it.", rows: [
      ["What counts", "Items you marked \"It expired\" this month."],
      ["Dollars", "Each item at the price you last paid. An item with no price counts as $0."]] },
  };

  /* The powers. Quest is not listed (owner). `unlock` says what the
   * household does to turn a power on; `on` reads the facts. */
  const POWERS = [
    { id: "community", group: "next", name: "Community prices", what: "See what other Arya households paid for the same item at other stores.",
      unlock: "Turn on Share anonymous prices. You give item, store and price by the week, never your name, list or receipt photo.",
      when: "A price shows only when 5 or more households agree in the last 30 days.", share: true },
    { id: "deals", group: "next", name: "Deals for you", what: "A heads-up when an item you buy is cheaper than usual somewhere near you.",
      unlock: "Needs Community prices. Only items you already buy.", when: "Built from shared prices, never from store sites or flyers.", share: true },
    { id: "shoppers", group: "next", name: "Arya Shoppers", what: "How busy a store is right now: Quiet, Busy or Packed, from people shopping there with Arya.",
      unlock: "Opt in to be counted while you shop. Nobody is shown by name or on a map.", when: "Under 3 Arya Shoppers there, it only says Quiet.", share: true },
    { id: "compare", group: "new", name: "Compare your stores", what: "Ask \"how much was milk at Costco?\" in the aisle, and see the cheaper store on any item.",
      unlock: "Add receipts from 2 different stores.", on: f => f.stores >= 2, tip: "Arya can tell you which of your stores is cheaper for an item." },
    { id: "trends", group: "new", name: "Price trends", what: "See when an item you buy gets dearer or cheaper, and your own inflation in Analysis.",
      unlock: "Add 3 receipts.", on: f => f.receipts >= 3, tip: "Arya can tell you which of your usual items are getting pricier." },
    { id: "similar", group: "new", name: "Similar items", what: "Other items of the same kind you bought, with what you paid, per ounce when sizes are known.",
      unlock: "Add 1 receipt.", on: f => f.receipts >= 1, tip: "Arya can compare similar items you have bought, per ounce." },
    { id: "split", group: "new", name: "Split smarter", what: "Which store to buy what at, and what that saves you a month.",
      unlock: "Add receipts from 2 different stores.", on: f => f.stores >= 2, tip: "Arya can show which store to buy what at, and what it saves." },
    { id: "waste", group: "new", name: "Food waste", what: "What expired this month, in dollars, from the items you mark \"It expired\".",
      unlock: "Tap It expired when food goes off.", on: () => true, tip: "Tap It expired on Today and Arya counts what food waste costs you." },
    { id: "low", group: "on", name: "Running low", what: "What is about to run out, from how often you buy it." },
    { id: "lists", group: "on", name: "Lists for each store", what: "One list per store. Add by typing, voice or photo." },
    { id: "usesoon", group: "on", name: "Use soon", what: "Snap an expiry date and Arya reminds you before it goes off." },
    { id: "plan", group: "on", name: "Plan a shop", what: "Your list sorted by where you usually buy each item." },
    { id: "receipts", group: "on", name: "Receipt check", what: "One photo files a receipt. Arya checks the total and nets returns." },
    { id: "patterns", group: "on", name: "Patterns", what: "What you spend, by month, store and item." },
    { id: "ask", group: "on", name: "Ask Arya", what: "Ask about your food and spending, by text or voice." },
    { id: "find", group: "on", name: "Find it for me", what: "The camera looks for the next item on your list." },
    { id: "alerts", group: "on", name: "Store alerts", what: "\"Not here?\" reports from other shoppers, before you walk the aisle." },
    { id: "haul", group: "on", name: "Share a haul", what: "A photo of what you bought, through your phone's share sheet." },
  ];

  const isOn = p => p.group === "on" || (p.on ? p.on(facts) : false);

  function infoBtn(key) {
    return `<button class="infobtn" type="button" data-info="${esc(key)}" aria-label="How this works">i</button>`;
  }

  function open(html) {
    body.innerHTML = `<span class="sheetgrip"></span>${html}`;
    wrap.hidden = false;
  }
  function close() { wrap.hidden = true; body.innerHTML = ""; }

  function rowsHtml(rows) {
    return rows.map(([b, s]) => `<div class="whyrow"><div><b>${esc(b)}</b><span class="sub">${esc(s)}</span></div></div>`).join("");
  }

  function openInfo(key) {
    const p = POWERS.find(x => x.id === key);
    if (p) {
      const rows = [["What it does", p.what]];
      if (!isOn(p) && p.unlock) rows.push(["To unlock", p.unlock]);
      if (p.when) rows.push([p.share ? "When you see it" : "Good to know", p.when]);
      const act = p.share
        ? `<button class="btn primary" type="button" data-pw="share">${facts.share_prices ? "Sharing is on" : "Share prices"}</button>` : "";
      open(`<h3 class="largetitle" style="font-size:22px;margin:0 0 2px">${esc(p.name)}</h3>${rowsHtml(rows)}
        <div class="sheetacts"><button class="btn secondary" type="button" data-pw="close">Close</button>${act}</div>`);
      return;
    }
    const i = INFO[key];
    if (!i) return;
    open(`<h3 class="largetitle" style="font-size:22px;margin:0 0 2px">${esc(i.t)}</h3><span class="sub">${esc(i.s)}</span>${rowsHtml(i.rows)}
      <div class="sheetacts"><button class="btn secondary" type="button" data-pw="close">Close</button></div>`);
  }

  /* Why sharing helps each other (owner: reinforce it). Sharing starts
   * when the community price store ships; today this records the choice. */
  function openShare() {
    open(`<h3 class="largetitle" style="font-size:22px;margin:0 0 2px">Shop smarter together</h3>
      <span class="sub">Every receipt and report makes prices better for you and for other Arya households.</span>
      ${rowsHtml([
        ["You give", "Item, store and price, by the week. Never your name, your list, your receipt photo or what else you bought."],
        ["You get", "Prices at other stores from real shoppers near you, and deals on items you buy."],
        ["Reports matter too", "\"Not here?\" tells the next shopper before they walk the aisle."]])}
      <div class="sheetacts"><button class="btn secondary" type="button" data-pw="close">Not now</button>
        <button class="btn primary" type="button" data-pw="${facts.share_prices ? "unshare" : "doshare"}">${facts.share_prices ? "Stop sharing" : "Share prices"}</button></div>
      <p class="sub nomargin" style="text-align:center;font-size:13px">Optional. You can turn it off here any time.</p>`);
  }

  async function setShare(on) {
    const r = await post("/api/powers/share", { on });
    facts.share_prices = !!r.share_prices;
    close();
    toast(on ? "Thank you. Sharing starts when enough households near you join." : "Sharing is off.");
    if (!$("#view-powers").hidden) paintPowers();
  }

  wrap.addEventListener("click", ev => {
    if (ev.target === wrap) { close(); return; }
    const b = ev.target.closest("[data-pw]");
    if (!b) return;
    const a = b.dataset.pw;
    if (a === "close") close();
    else if (a === "share") openShare();
    else if (a === "doshare") setShare(true).catch(e => toast(e.message));
    else if (a === "unshare") setShare(false).catch(e => toast(e.message));
  });

  // Any (i) anywhere in the app opens its sheet.
  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-info]");
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    openInfo(b.dataset.info);
  }, true);

  async function loadFacts() {
    try { facts = await api("/api/powers"); } catch (e) { /* keep the last facts */ }
    return facts;
  }

  /* ---- The Powers page: one line per power, groups collapse. ---- */
  function powRow(p) {
    const on = isOn(p);
    const state = on ? "" : (p.share && facts.share_prices ? "Waiting" : (p.share ? "Opt in" : "Locked"));
    return `<div class="row powrow"><span class="pwdot${on ? " on" : ""}" aria-hidden="true">${on ? "✓" : ""}</span>
      <div class="grow"><span class="name">${esc(p.name)}</span></div>
      ${state ? `<span class="pwstate">${state}</span>` : ""}${infoBtn(p.id)}</div>`;
  }

  function group(id, title, items, openNow) {
    if (!items.length) return "";
    return `<details class="pwgroup" ${openNow ? "open" : ""}><summary><h3 class="sect">${esc(title)}</h3><span class="pwchev" aria-hidden="true">›</span></summary>
      <div class="group">${items.map(powRow).join("")}</div></details>`;
  }

  async function paintPowers() {
    await loadFacts();
    const g = k => POWERS.filter(p => p.group === k);
    $("#powers-body").innerHTML =
      group("next", "Unlock next", g("next"), true) +
      group("new", "New", g("new"), true) +
      group("on", `Working for you (${g("on").length})`, g("on"), false);
  }

  /* ---- Today: one "Did you know?" card a day. ---- */
  const TIP_KEY = "arya-tip-hidden";
  function hiddenTips() {
    try { return JSON.parse(localStorage.getItem(TIP_KEY) || "{}"); } catch (e) { return {}; }
  }
  function hideTip(id) {
    const h = hiddenTips();
    h[id] = new Date().toISOString().slice(0, 10);
    try { localStorage.setItem(TIP_KEY, JSON.stringify(h)); } catch (e) { /* private window */ }
  }

  function todaysTip() {
    const tips = POWERS.filter(p => p.tip || p.share);
    const today = new Date().toISOString().slice(0, 10);
    const hid = hiddenTips();
    if (Object.values(hid).includes(today)) return null;    // one a day, and Not now means not today
    const start = Math.floor(Date.now() / 864e5) % tips.length;
    for (let k = 0; k < tips.length; k++) {
      const p = tips[(start + k) % tips.length];
      if (!hid[p.id]) return p;
    }
    return null;
  }

  async function paintToday() {
    const el = $("#today-tip");
    if (!el) return;
    await loadFacts();
    const p = todaysTip();
    if (!p) { el.innerHTML = ""; return; }
    const on = isOn(p);
    const title = p.tip || (p.id === "community" ? "Arya can show what other shoppers paid" : p.id === "deals" ? "Arya can find deals on what you buy" : "Arya can tell you how busy a store is");
    const step = on
      ? `<div class="tipstep"><span class="pwdot on">✓</span><div><b>It's on</b><span class="sub">${esc(p.what)}</span></div></div>`
      : `<div class="tipstep"><span class="pwdot"></span><div><b>To unlock</b><span class="sub">${esc(p.unlock)}</span></div></div>`;
    const go = p.share && !facts.share_prices
      ? `<button class="btn primary" type="button" data-tip="share">Share prices</button>`
      : `<button class="btn primary" type="button" data-tip="all">See all powers</button>`;
    // Design pass (2026-10-29): the tip is one quiet line at the foot of
    // Today, not a card in the middle of it. The full card (step and
    // buttons) is the Powers page the line opens.
    const act = p.share && !facts.share_prices ? "share" : "all";
    el.innerHTML = `<div class="tipline"><button class="hubrow" type="button" data-tip="${act}"><span class="hr-label"><span class="tipkick">Did you know?</span>${esc(title)}</span><span class="chev">›</span></button><button class="tipx" type="button" data-tip="hide" data-tip-id="${esc(p.id)}" aria-label="Not now">×</button></div>`;
  }

  document.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-tip]");
    if (!b) return;
    const a = b.dataset.tip;
    if (a === "hide") { hideTip(b.dataset.tipId); $("#today-tip").innerHTML = ""; }
    else if (a === "share") openShare();
    else if (a === "all") { show("view-powers"); paintPowers().catch(showErr); }
  });

  /* ---- Analysis: Your prices. ---- */
  function pct(n) { return `${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0).replace(/\.0$/, "")}%`; }
  function names(list) {
    const n = list.map(esc);
    return n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  }

  async function paintAnalysis() {
    const el = $("#an-prices");
    if (!el) return;
    const r = await api("/api/prices/insights").catch(() => null);
    const cards = [];
    const b = r && r.basket;
    if (b) {
      const head = Math.abs(b.pct) < 1 ? `Your basket costs about the same as in ${esc(b.since_month)}`
        : `Your basket costs ${pct(b.pct)} ${b.pct > 0 ? "more" : "less"} than in ${esc(b.since_month)}`;
      const dollars = Math.abs(b.month_dollars) >= 1 ? ` About ${money(Math.abs(b.month_dollars))} ${b.month_dollars > 0 ? "more" : "less"} a month.` : "";
      const movers = (b.movers || []).map(m => `<div class="pricerow"><span>${esc(m.name)}</span><span class="${m.pct > 0 ? "up" : "down"}">${m.pct > 0 ? "↑" : "↓"} ${pct(m.pct)}</span></div>`).join("");
      cards.push(`<div class="group pad pricecard"><div class="pchead"><span class="name">${head}</span>${infoBtn("basket")}</div>
        <span class="sub">Same ${b.items} items you buy often.${dollars}</span>${movers ? `<div class="pricerows">${movers}</div>` : ""}</div>`);
    }
    const s = r && r.split;
    if (s) {
      const byTo = {};
      for (const m of s.moves) (byTo[m.to] = byTo[m.to] || []).push(m.name);
      const lines = Object.entries(byTo).map(([st, ns]) => `Buy ${names(ns)} at ${esc(st)}.`).join(" ");
      cards.push(`<div class="group pad pricecard"><div class="pchead"><span class="name">Split smarter, save about ${money(s.month_dollars)} a month</span>${infoBtn("split")}</div>
        <span class="sub">${lines}</span></div>`);
    }
    const w = r && r.waste;
    if (w) {
      const top = w.items.slice(0, 2).map(i => i.name);
      cards.push(`<div class="group pad pricecard"><div class="pchead"><span class="name">${money(w.dollars)} of food expired in ${esc(w.month)}</span>${infoBtn("waste")}</div>
        <span class="sub">${w.items.length === 1 ? esc(top[0]) : `Mostly ${names(top)}`}.</span></div>`);
    }
    el.innerHTML = cards.length ? `<h3 class="sect">Your prices</h3>${cards.join("")}` : "";
  }

  window.Powers = { paintPowers, paintToday, paintAnalysis, openShare, infoBtn, openInfo };
})();
