"use strict";
/* Arya Pack — the pre-hunt list step (Pack slice).
 *
 * Plan a hunt picks the store, then this module runs the bag:
 *  - a dealt-card deck for items the shopper has not decided yet
 *    (left from last trip, a friend's haul, kid adds, what is due or
 *    usual here). Pack puts a card in the bag. Skip puts it in the
 *    restorable Skipped group. Back one card undoes the last card.
 *  - bag rows with quantity, note, brand and an Edit sheet
 *  - typed items that appear as rows at once, duplicates merged
 *  - a private cost estimate and an opt-in budget (this phone only)
 *  - a helper mode where a kid's adds wait for a grown-up's OK (hidden)
 *
 * Every decision is a row in draft.pick[key]:
 *   {name, qty, on, skipped?, extra?, src?, aisle?, note?, variant?,
 *    by?, itemId?, joinList?, queuedId?, from?}
 * Pack = on:true. Skip = on:false, skipped:true. Back one card
 * deletes the row. No points for packing or skipping. Nothing here
 * calls a model, and prices and budget never leave the phone.
 *
 * Loaded BEFORE quest.js and with no dependency on it at load time.
 * quest.js calls PACK only behind typeof PACK !== "undefined".
 * Pure logic (parseLine, buildDeck, estimate...) runs under node. */
const PACK = (() => {
  const KEY_DRAFT = "arya-pack-draft";
  const KEY_BUDGET = "arya-pack-budget";
  const KEY_HELPER = "arya-helper-name";
  // Helper mode is hidden for now: no toggle, no lock. The code stays so it
  // can come back; setHelperEnabled(true) turns it on (tests use it).
  let HELPER_ENABLED = false;
  const DRAFT_MAX_AGE = 12 * 3600 * 1000;
  const UNDO_DEPTH = 20;
  const DECK_CAP = 12;
  const ANIM_MS = 220;
  const STARTERS = ["Eggs", "Milk", "Bananas", "Bread"];
  const AISLES = ["Produce", "Bakery", "Deli", "Dairy", "Pantry", "Frozen", "Household"];

  /* ---------------- phone storage, never fatal ---------------- */

  const MEM = {};
  function lsGet(k) {
    try { const v = localStorage.getItem(k); return v === undefined ? null : v; } catch (e) { /* blocked: use memory */ }
    return k in MEM ? MEM[k] : null;
  }
  function lsSet(k, v) {
    MEM[k] = String(v);
    try { localStorage.setItem(k, String(v)); } catch (e) { /* kept in memory */ }
  }
  function lsDel(k) {
    delete MEM[k];
    try { localStorage.removeItem(k); } catch (e) { /* nothing to do */ }
  }

  /* ---------------- small helpers (own copies) ---------------- */

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  /* Singular for comparison only: berries -> berry, eggs -> egg. */
  function squash(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
    if (w.length > 2 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }
  function squashName(s) { return norm(s).split(" ").filter(Boolean).map(squash).join(" "); }
  function sameStore(a, b) {
    const x = norm(a), y = norm(b);
    return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
  }
  function storeCount(stores, store) {
    return Object.entries(stores || {}).reduce((n, [s, c]) => n + (sameStore(s, store) ? c : 0), 0);
  }
  function titleCase1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function say(msg, opts) { if (typeof toast === "function") toast(msg, opts); }
  function qEl(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  /* ---------------- parsing what the shopper types ---------------- */

  const SIZE_RE = new RegExp(
    "(?:^|\\s)(\\d+(?:\\.\\d+)?\\s*(?:fl\\s*oz|oz|lbs?|pounds?|kg|mg|g|ml|lt|ltr|liters?|litres?|l|ct|count|pk|pack|dozen|doz|gal|gallons?|qt|quarts?|pt|pints?)|dozen|doz)(?=\\s|$)", "i");
  const NUMERIC_BRANDS = ["7 up", "7up", "5 alive", "100 grand", "3 musketeers", "5 hour energy"];

  /* "2x tortillas", "tortillas x2", "2 tortillas", "salsa 16oz",
   * "eggs 1 dozen", "12 ct eggs" -> {name, qty, note}. A size
   * (400g, 1 lb, dozen, 12 ct) is a note, never the quantity.
   * Angle brackets are dropped; the name is escaped when drawn. */
  function parseLine(text) {
    let s = String(text == null ? "" : text).replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return { name: "", qty: 1, note: "" };
    let qty = 1, note = "";
    const low = s.toLowerCase();
    const brand = NUMERIC_BRANDS.some(b => low === b || low.startsWith(b + " "));
    if (!brand) {
      const m = SIZE_RE.exec(s);
      if (m) {
        note = m[1].replace(/\s+/g, " ").trim();
        s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
      }
      let q;
      if ((q = s.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i)) || (q = s.match(/^(\d{1,2})\s+(.+)$/))) {
        qty = Number(q[1]); s = q[2].trim();
      } else if ((q = s.match(/^(.+?)\s+[x×]\s*(\d{1,2})$/i)) || (q = s.match(/^(.+?)\s+(\d{1,2})\s*[x×]$/i)) ||
                 (q = s.match(/^(.+?)\s+(\d{1,2})$/))) {
        qty = Number(q[2]); s = q[1].trim();
      }
      if (qty < 1) qty = 1;
    }
    if (!s) s = note, note = "";
    return { name: titleCase1(s), qty, note };
  }

  /* Newline, then ";", then commas. */
  function splitInput(text) {
    const lines = String(text == null ? "" : text).split(/[\n;]+/)
      .map(p => p.trim()).filter(Boolean);
    // quest.js qParseText also splits a spoken or typed sentence ("I need
    // some eggs and milk") and strips lead-ins and fillers.
    if (typeof qParseText === "function") {
      return lines.flatMap(l => {
        // A plain line stays exactly as typed; only a sentence splits.
        if (!/,/.test(l) && !/^(i need|we need|get me|get|buy|add|please add|please get)\s/i.test(l)) return [l];
        return qParseText(l).map(it => (it.qty > 1 ? it.qty + "x " : "") + it.name);
      });
    }
    return lines.flatMap(p => p.split(",")).map(p => p.trim()).filter(Boolean);
  }

  /* An aisle LABEL from a keyword map. It is a hint for the bag and
   * the hunt, never a claim about a particular store. */
  const AISLE_WORDS = [
    ["Frozen", ["frozen", "ice cream", "popsicle", "gelato", "sorbet", "waffles"]],
    ["Household", ["paper towel", "toilet paper", "tissue", "detergent", "dish soap", "soap", "trash bag", "sponge", "foil", "bleach", "diaper", "wipes", "shampoo", "toothpaste", "napkin", "cleaner", "laundry", "batteries", "light bulb"]],
    ["Pantry", ["peanut butter", "almond butter", "egg noodle", "pasta sauce", "tomato sauce"]],
    ["Dairy", ["milk", "cheese", "yogurt", "yoghurt", "butter", "egg", "cream", "kefir", "cottage", "half and half", "creamer"]],
    ["Bakery", ["bread", "bagel", "tortilla", "bun", "roll", "muffin", "croissant", "baguette", "pita", "cake", "donut", "naan"]],
    ["Deli", ["ham", "turkey", "salami", "deli", "prosciutto", "hummus", "bacon", "sausage", "rotisserie", "pastrami"]],
    ["Pantry", ["pasta", "spaghetti", "noodle", "rice", "cereal", "oats", "oatmeal", "granola", "flour", "sugar", "olive oil", "oil", "vinegar", "sauce", "salsa", "ketchup", "mustard", "mayo", "beans", "canned", "soup", "broth", "coffee", "tea", "honey", "jam", "nuts", "almonds", "cracker", "chips", "popcorn", "snack", "spice", "salt", "cookies", "chocolate", "syrup", "tuna"]],
    ["Produce", ["apple", "banana", "berry", "strawberry", "blueberry", "raspberry", "grape", "orange", "lemon", "lime", "avocado", "tomato", "onion", "garlic", "potato", "carrot", "lettuce", "spinach", "kale", "salad", "cucumber", "pepper", "broccoli", "cauliflower", "celery", "mushroom", "cilantro", "parsley", "basil", "herb", "fruit", "vegetable", "melon", "mango", "pear", "peach", "zucchini", "squash", "corn", "ginger", "pineapple"]],
  ];
  const AISLE_PADDED = AISLE_WORDS.map(([label, words]) => [label, words.map(w => " " + squashName(w) + " ")]);
  function aisleFor(name) {
    const hay = " " + squashName(name) + " ";
    if (hay.trim() === "") return "";
    for (const [label, words] of AISLE_PADDED) {
      if (words.some(w => hay.includes(w))) return label;
    }
    return "";
  }

  /* A name without its size words: "Oat Milk 1 L" -> "oat milk",
   * "Pasture Eggs 12 ct" -> "pasture egg". Comparison only. */
  function coreName(s) {
    const g = new RegExp(SIZE_RE.source, "gi");
    return squashName(String(s || "").replace(g, " "));
  }
  /* The row with exactly this name (case, spacing and plurals
   * ignored). The only match that may carry an item id. */
  function exactRow(name, rows) {
    const t = squashName(name);
    if (!t) return null;
    for (const r of rows || []) if (squashName(r.name) === t) return r;
    return null;
  }
  /* An existing row for a typed name. Never a guess: an exact name,
   * else the one row whose name is the same words once size and unit
   * words are removed ("whole milk" is "Whole Milk 1 gal"; "milk"
   * is not, and "butter" is not "Peanut Butter"). Two candidates is
   * ambiguous, so none. */
  function matchRow(name, rows) {
    const exact = exactRow(name, rows);
    if (exact) return exact;
    const t = coreName(name);
    if (!t) return null;
    const hits = (rows || []).filter(r => coreName(r.name) === t);
    return hits.length === 1 ? hits[0] : null;
  }

  /* ---------------- the deck ---------------- */

  function cardId(kind, key) { return kind + ":" + key; }

  /* The cards the shopper has not decided yet, in this order:
   * left from last trip, a friend's haul, list rows a helper added,
   * then what is due or usual here by ripeness. Deduped against the
   * list, the picks and each other; at most 12. With no purchase
   * history only left-over and haul cards appear (no claims). */
  function buildDeck(o) {
    const plan = (o && o.plan) || {};
    const store = (o && o.store) || "";
    const pick = (o && o.pick) || {};
    const carried = (o && o.carried) || plan.carried || [];
    const queued = (o && o.queued) || plan.queued || [];
    const list = plan.list || [];
    const seen = new Set();
    for (const r of list) seen.add(squashName(r.name));
    for (const k of Object.keys(pick)) seen.add(squashName((pick[k] && pick[k].name) || k));
    const cards = [];
    const add = c => {
      const sq = squashName(c.name);
      if (!sq || seen.has(sq) || cards.length >= DECK_CAP) return;
      seen.add(sq);
      cards.push(c);
    };
    for (const c of carried) {
      if (!c || !c.name) continue;
      add({ id: cardId("carried", norm(c.name)), key: norm(c.name), name: c.name, qty: Math.max(1, Number(c.qty) || 1),
        kind: "carried", src: "carried", chip: "Left from last trip", reason: "Left from last trip.",
        note: c.note || "", variant: c.variant || "", by: c.by || "", aisle: c.aisle || "" });
    }
    const satisfied = [];
    for (const q of queued) {
      if (!q || !q.name) continue;
      const from = String(q.from || "").replace(/^@/, "");
      // Already on the list or in the bag: the haul item is answered.
      if (q.id && seen.has(squashName(q.name))) { satisfied.push(q.id); continue; }
      add({ id: cardId("queued", norm(q.name)), key: norm(q.name), name: q.name, qty: Math.max(1, Number(q.qty) || 1),
        kind: "queued", src: "queued", queued_id: q.id, from,
        chip: from ? `From @${from}'s haul` : "From a friend's haul",
        reason: from ? `From @${from}'s haul.` : "From a friend's haul." });
    }
    // List rows are already bag rows. The ones a helper added are
    // dealt first so a grown-up can say yes or no. They are removed
    // from `seen` so the dedupe above does not hide them.
    for (const r of list) {
      if (!r.added_by || r.approved) continue;
      const key = norm(r.name);
      if (key in pick) continue;
      if (cards.some(c => squashName(c.name) === squashName(r.name))) continue;
      seen.delete(squashName(r.name));
      add({ id: cardId("added", key), key, name: r.name, qty: Math.max(1, Number(r.qty) || 1),
        kind: "added", src: "added", by: r.added_by, itemId: r.item_id,
        chip: `Added by ${r.added_by}`, reason: `${r.added_by} added this.` });
    }
    if (plan.has_history) {
      const here = (plan.items || [])
        .map(i => ({ i, n: storeCount(i.stores, store) }))
        .filter(x => x.i.name && ((x.i.due && x.n >= 1) || x.n >= 2))
        .map(x => ({ ...x, ripe: x.i.every_days ? (x.i.days_since || 0) / x.i.every_days : 0 }))
        .sort((a, b) => (Number(!!b.i.due) - Number(!!a.i.due)) || (b.ripe - a.ripe) || (b.n - a.n));
      for (const { i, n } of here) {
        const key = norm(i.name);
        add({ id: cardId(i.due ? "due" : "usual", key), key, name: i.name,
          qty: Math.max(1, Math.round(Number(i.typical_qty) || 1)),
          kind: i.due ? "due" : "usual", src: i.due ? "due" : "usual",
          chip: i.due ? "Due now" : "Usual here",
          every_days: i.every_days || null, days_since: i.days_since == null ? null : i.days_since,
          typical_qty: i.typical_qty || null, here: n, itemId: i.item_id });
      }
    }
    cards.satisfied = satisfied;
    return cards;
  }

  /* Short plain sentences, one idea each. Only facts Arya holds. */
  function reasonFor(c) {
    if (!c) return "";
    if (c.kind === "carried") return "Left from last trip.";
    if (c.kind === "queued") return c.from ? `From @${c.from}'s haul.` : "From a friend's haul.";
    if (c.kind === "added") return `${c.by || "Someone"} added this.`;
    const out = [];
    if (c.every_days) out.push(`You buy this about every ${Math.round(c.every_days)} days.`);
    if (c.days_since != null) out.push(`Last bought ${Math.round(c.days_since)} ${plural(Math.round(c.days_since), "day", "days")} ago.`);
    if (c.typical_qty && c.typical_qty > 1) out.push(`You usually get ${Math.round(c.typical_qty)}.`);
    if (c.here) out.push(`Bought here ${c.here} ${plural(c.here, "time", "times")}.`);
    return out.slice(0, 3).join(" ");
  }

  /* Drag release: right packs, left skips, short drags spring back. */
  function dragDecision(dx, width) {
    const t = Math.max(80, 0.25 * (Number(width) || 0));
    if (dx > t) return "pack";
    if (dx < -t) return "skip";
    return null;
  }

  /* ---------------- the private estimate ---------------- */

  function planItem(plan, row) {
    const items = (plan && plan.items) || [];
    if (row.itemId) { const hit = items.find(i => i.item_id === row.itemId); if (hit) return hit; }
    const sq = squashName(row.name);
    return items.find(i => squashName(i.name) === sq) || null;
  }
  /* The median unit price where the shopper buys it here, else the
   * overall median. A row with no price is not counted. */
  function estimate(rows, plan, store) {
    let total = 0, priced = 0;
    const list = rows || [];
    for (const r of list) {
      const it = planItem(plan, r);
      if (!it) continue;
      let unit = null;
      for (const [s, p] of Object.entries(it.prices || {})) if (sameStore(s, store) && p > 0) unit = p;
      if (unit == null && it.price > 0) unit = it.price;
      if (unit == null) continue;
      total += unit * Math.max(1, Number(r.qty) || 1);
      priced += 1;
    }
    return { total: Math.round(total * 100) / 100, priced, count: list.length };
  }
  function estimateLine(est) {
    if (!est || !est.priced) return "";
    const t = "$" + Math.round(est.total);
    const part = est.priced === est.count
      ? `your ${est.count} ${plural(est.count, "item", "items")}`
      : `${est.priced} of your ${est.count} items`;
    return `About ${t} for ${part}. Only you see this.`;
  }
  /* Calm grey copy. Empty when under budget or no budget is set. */
  function budgetLine(total, budget) {
    const b = Number(budget);
    if (!(b > 0) || !(total > 0)) return "";
    const over = Math.round(total - b);
    if (over < 1) return "";
    return `About $${over} over your budget. Want to leave something for next trip?`;
  }

  /* ---------------- session shape ---------------- */

  function clip(v, n) { return String(v == null ? "" : v).trim().slice(0, n).trim(); }
  /* One row of the quest as the optimizer takes it. */
  function rawItem(p) {
    const out = { name: p.name, qty: Math.max(1, Number(p.qty) || 1) };
    const aisle = clip(p.aisle, 60) || aisleFor(p.name);
    if (clip(p.note, 60)) out.note = clip(p.note, 60);
    if (clip(p.variant, 60)) out.variant = clip(p.variant, 60);
    if (clip(p.by, 24)) out.by = clip(p.by, 24);
    out.src = p.src || "list";
    if (aisle) out.aisle = aisle;
    return out;
  }
  /* One optimizer item as the session takes it. */
  function sessionItem(i, extras) {
    const out = { name: i.name, qty: i.qty };
    if (i.group) out.group = i.group;
    const e = extras || {};
    for (const k of ["note", "variant", "by", "src", "aisle"]) {
      const v = i[k] || e[k];
      if (v) out[k] = v;
    }
    return out;
  }
  /* The extras of the first raw line that carries this name. */
  function extrasOf(raw, name) {
    const n = norm(name);
    const hit = (raw || []).find(r => norm(r.name) === n);
    if (!hit) return {};
    const out = {};
    for (const k of ["note", "variant", "by", "src", "aisle"]) if (hit[k]) out[k] = hit[k];
    return out;
  }

  /* ---------------- state ---------------- */

  let D = null;          // the plan draft (Q.draft)
  let PLAN = null;       // the /api/quest/plan payload
  let STORE = "";
  let SNAPS = [];        // exact snapshots for Undo, newest last
  let BUSY = false;
  let BUSY_T = null;
  let LEAVE = null;      // direction of the card that just left
  let KEYFOCUS = false;  // the last decision came from the keyboard

  function pk() { return D && D.pack ? D.pack : null; }
  function newPack(store) {
    return {
      v: 1, store, deck: [], deal: 0, decisions: [],
      expanded: { bag: false, skipped: false },
      helper: { on: false, name: lsGet(KEY_HELPER) || "", pending: [] },
      budget: lsGet(KEY_BUDGET) || "",
    };
  }

  /* ---- draft persistence: same store, under 12 hours ---- */
  function worthSaving() {
    const P = pk();
    if (!P || !D) return false;
    return P.deal > 0 || P.helper.pending.length > 0 ||
      Object.values(D.pick || {}).some(r => r && r.extra);
  }
  function save() {
    const P = pk();
    if (!P) return;
    if (!worthSaving()) return;
    lsSet(KEY_DRAFT, JSON.stringify({ v: 1, t: Date.now(), store: STORE, pick: D.pick, pack: P }));
  }
  function loadSaved(store) {
    const raw = lsGet(KEY_DRAFT);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || o.v !== 1 || !o.pack || o.pack.v !== 1 || !o.pick || typeof o.pick !== "object") return null;
      if (!sameStore(o.store, store) || !(Date.now() - o.t < DRAFT_MAX_AGE)) return null;
      if (!Array.isArray(o.pack.deck) || !Array.isArray(o.pack.decisions) || !o.pack.helper) return null;
      return o;
    } catch (e) { return null; }
  }
  function clearDraft() { lsDel(KEY_DRAFT); }

  /* Open (once per store) the bag for this draft. */
  function open(draft, plan, store) {
    D = draft; PLAN = plan || { list: [], items: [] }; STORE = store || "";
    if (draft.pack && draft.pack.v === 1 && sameStore(draft.pack.store, STORE)) return draft.pack;
    SNAPS = []; BUSY = false;
    const saved = loadSaved(STORE);
    if (saved) {
      draft.pick = saved.pick;
      draft.pack = saved.pack;
      draft.pack.budget = lsGet(KEY_BUDGET) || draft.pack.budget || "";
      say("Welcome back. Your bag is saved.", { action: "Start over", onAction: reset });
      return draft.pack;
    }
    draft.pack = newPack(STORE);
    draft.pack.deck = buildDeck({ plan: PLAN, store: STORE, pick: draft.pick || {} });
    draft.pack.satisfied = draft.pack.deck.satisfied || [];
    return draft.pack;
  }
  /* Start over: forget the saved bag and deal again. */
  function reset() {
    if (!D) return;
    clearDraft();
    SNAPS = [];
    D.pick = {};
    D.pack = newPack(STORE);
    D.pack.deck = buildDeck({ plan: PLAN, store: STORE, pick: {} });
    D.pack.satisfied = D.pack.deck.satisfied || [];
    render();
  }
  /* The session was made: the draft is done. Queued cards that were
   * dealt (packed or skipped) leave the Same-haul queue. */
  function finish() {
    const P = pk();
    const ids = P && Array.isArray(P.satisfied) ? P.satisfied.slice() : [];
    if (P) {
      P.deck.slice(0, P.deal).forEach(c => { if (c.queued_id && !ids.includes(c.queued_id)) ids.push(c.queued_id); });
    }
    clearDraft();
    if (ids.length && typeof post === "function") {
      try { Promise.resolve(post("/api/quest/queued/finish", { ids })).catch(() => {}); } catch (e) { /* fire and forget */ }
    }
    if (D) D.pack = null;
    SNAPS = [];
    return ids;
  }

  /* ---- undo ---- */
  function snap() {
    if (!D) return;
    SNAPS.push(JSON.stringify({ pick: D.pick, pack: D.pack }));
    if (SNAPS.length > UNDO_DEPTH) SNAPS.shift();
  }
  function undo() {
    const s = SNAPS.pop();
    if (!s || !D) { say("Nothing to undo."); return false; }
    const o = JSON.parse(s);
    D.pick = o.pick; D.pack = o.pack;
    BUSY = false;
    closeEdit(true);
    render();
    save();
    say("Undone.");
    return true;
  }
  function render(leaving) {
    LEAVE = leaving || null;
    if (typeof renderPlan === "function" && D && D.store) renderPlan();
    else { paintDeck(); paintFoot(); syncStart(); }
  }
  /* After a change: draw, save, and offer Undo. */
  function done(msg, leaving) {
    render(leaving);
    save();
    if (msg) say(msg, { action: "Undo", onAction: undo });
  }
  function settleLater() {
    BUSY = true;
    clearTimeout(BUSY_T);
    BUSY_T = setTimeout(() => { BUSY = false; }, reduced() ? 0 : ANIM_MS);
  }

  /* ---- rows ---- */
  function rowOf(card, on) {
    const r = { name: card.name, qty: Math.max(1, Number(card.qty) || 1), on, src: card.src };
    if (!on) r.skipped = true;
    if (card.kind !== "added") r.extra = true;
    for (const k of ["note", "variant", "by", "aisle", "itemId"]) if (card[k]) r[k] = card[k];
    if (card.queued_id) r.queuedId = card.queued_id;
    if (card.from) r.from = card.from;
    if (card.kind === "added") r.src = "added";
    return r;
  }
  function pickedRows() {
    return Object.entries((D && D.pick) || {}).filter(([, r]) => r && r.on).map(([key, r]) => ({ key, ...r }));
  }
  function applyCard(kind, card, prior) {
    const on = kind === "pack";
    const had = D.pick[card.key];
    prior.push(had ? JSON.parse(JSON.stringify(had)) : null);
    D.pick[card.key] = rowOf(card, on);
  }

  /* The one mutator for a single card. Safe against double taps: it
   * returns early while busy and when cardId is not the current
   * card. The state changes at once; the 220 ms motion is cosmetic. */
  function decide(kind, cardId) {
    const P = pk();
    if (!P || BUSY || (kind !== "pack" && kind !== "skip")) return false;
    const c = P.deck[P.deal];
    if (!c || c.id !== cardId) return false;
    settleLater();
    snap();
    const prior = [];
    applyCard(kind, c, prior);
    P.decisions.push({ cardId: c.id, kind, key: c.key, had: prior[0] });
    P.deal += 1;
    done(kind === "pack" ? `${c.name} packed.` : `${c.name} skipped.`, kind === "pack" ? "r" : "l");
    return true;
  }
  function back() {
    const P = pk();
    if (!P || BUSY || !P.decisions.length) return false;
    snap();
    const d = P.decisions.pop();
    if (d.had) D.pick[d.key] = d.had; else delete D.pick[d.key];
    P.deal = Math.max(0, P.deal - 1);
    done("Back one card.");
    return true;
  }
  function locked() { const P = pk(); return !!(HELPER_ENABLED && P && P.helper.on); }
  function lockedSay() { say("Helper mode is on. Turn it off first."); }
  function remaining() { const P = pk(); return P ? Math.max(0, P.deck.length - P.deal) : 0; }
  function sweep(kind) {
    const P = pk();
    if (!P || BUSY) return false;
    if (locked()) { lockedSay(); return false; }
    const rest = P.deck.slice(P.deal);
    if (!rest.length) return false;
    snap();
    for (const c of rest) {
      const prior = [];
      applyCard(kind, c, prior);
      P.decisions.push({ cardId: c.id, kind, key: c.key, had: prior[0] });
    }
    P.deal = P.deck.length;
    done(kind === "pack" ? `All ${rest.length} ${plural(rest.length, "card", "cards")} packed.`
      : "The rest are skipped. You can find them under Skipped.");
    return true;
  }
  function packAll() { return sweep("pack"); }
  function skipRest() { return sweep("skip"); }
  function restore(key) {
    const r = D && D.pick[key];
    if (!r || !r.skipped) return false;
    snap();
    r.on = true; delete r.skipped;
    done(`${r.name} is in your bag.`);
    return true;
  }
  function setCardQty(delta) {
    const P = pk();
    const c = P && P.deck[P.deal];
    if (!c) return;
    c.qty = Math.min(99, Math.max(1, (c.qty || 1) + delta));
    const b = qEl("#pack-card .packqty b");
    if (b) b.textContent = String(c.qty);
  }
  /* Drop undecided cards that a typed or photographed item answers. */
  function dropPending(key) {
    const P = pk();
    if (!P) return;
    const sq = squashName(key);
    for (let i = P.deck.length - 1; i >= P.deal; i--) {
      if (squashName(P.deck[i].name) === sq) P.deck.splice(i, 1);
    }
  }
  function pendingKey(key) {
    const P = pk();
    if (!P) return false;
    return P.deck.slice(P.deal).some(c => c.key === key);
  }
  /* quest.js asks: does PACK draw this list row (pending card or skipped)? */
  function holds(key) {
    const r = D && D.pick && D.pick[key];
    return pendingKey(key) || !!(r && r.skipped);
  }

  /* ---------------- typed items ---------------- */

  function allRows() { return Object.entries((D && D.pick) || {}).map(([key, r]) => ({ key, ...r })); }
  function planMatch(name) {
    const items = (PLAN && PLAN.items) || [];
    // Exact name only. A close name is not the same product, so it
    // goes to the server as a name and the Ask flow settles it.
    const hit = exactRow(name, items.map(i => ({ name: i.name, item_id: i.item_id })));
    return hit ? hit.item_id : null;
  }
  /* Add one parsed item: merge into a matching row or make a row.
   * Returns a toast sentence. The caller snapshots first. */
  function addParsed(p, src, by) {
    const m = matchRow(p.name, allRows());
    if (m) {
      const r = D.pick[m.key];
      if (r.on) {
        r.qty = Math.min(99, (r.qty || 1) + p.qty);
        if (p.note && !r.note) r.note = p.note;
        dropPending(m.key);
        return `${r.name} is already in your bag. Now x${r.qty}.`;
      }
      r.on = true; delete r.skipped;
      r.qty = Math.max(r.qty || 1, p.qty);
      if (p.note && !r.note) r.note = p.note;
      dropPending(m.key);
      return `${r.name} is back in your bag.`;
    }
    const key = norm(p.name);
    const row = { name: p.name, qty: p.qty, on: true, extra: true, src, joinList: true };
    const aisle = aisleFor(p.name);
    if (aisle) row.aisle = aisle;
    if (p.note) row.note = p.note;
    if (by) { row.by = clip(by, 24); row.approved = true; }
    const itemId = planMatch(p.name);
    if (itemId) row.itemId = itemId;
    D.pick[key] = row;
    dropPending(key);
    return `${p.name}${p.qty > 1 ? " x" + p.qty : ""} is in your bag.`;
  }
  function helperName() { const P = pk(); return (P && P.helper.name) || "Helper"; }

  /* Text from the composer: one or many items. */
  function addFromText(text, src) {
    const P = pk();
    if (!P) return null;
    const parsed = splitInput(text).map(parseLine).filter(p => p.name);
    if (!parsed.length) { say("Type an item first."); return null; }
    snap();
    if (P.helper.on) {
      for (const p of parsed) P.helper.pending.push({ id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: p.name, qty: p.qty, note: p.note });
      done(`${helperName()} wants ${parsed.map(p => p.name).join(", ")}. Approve it below.`);
      return { pending: parsed.length };
    }
    const msgs = parsed.map(p => addParsed(p, src || "typed"));
    done(parsed.length === 1 ? msgs[0] : `${parsed.length} items are in your bag.`);
    return { added: parsed.length, messages: msgs };
  }
  function addStarter(name) {
    const P = pk();
    if (!P) return null;
    if (P.helper.on) return addFromText(name, "starter");
    snap();
    const msg = addParsed({ name, qty: 1, note: "" }, "starter");
    done(msg);
    return msg;
  }
  /* Photo items arrive as picks from quest.js; tidy the deck. */
  function afterBulkAdd() {
    const P = pk();
    if (!P) return;
    for (const key of Object.keys(D.pick)) dropPending(key);
    save();
    paintDeck(); paintFoot(); syncStart();
  }
  /* The composer text box counts toward Start until it is added. */
  function flush() {
    const box = qEl("#nl-text");
    const text = box ? box.value : "";
    if (!pk() || !String(text).trim()) return 0;
    const r = addFromText(text);
    if (box) box.value = "";
    return r ? (r.added || r.pending || 0) : 0;
  }

  /* ---------------- helper mode ---------------- */

  function setHelperEnabled(v) { HELPER_ENABLED = !!v; render(); }
  function setHelper(on) {
    const P = pk();
    if (!P || !HELPER_ENABLED) return;
    P.helper.on = !!on;
    render();
    save();
    if (on && !P.helper.name) { const f = qEl("#nl-helpername"); if (f && f.focus) f.focus(); }
  }
  function setHelperName(v) {
    const P = pk();
    if (!P) return;
    P.helper.name = clip(v, 24);
    if (P.helper.name) lsSet(KEY_HELPER, P.helper.name);
  }
  function approve(id) {
    const P = pk();
    const i = P ? P.helper.pending.findIndex(x => x.id === id) : -1;
    if (i < 0) return false;
    snap();
    const it = P.helper.pending.splice(i, 1)[0];
    // The helper's name goes to the server as `by` only now, on approval.
    const msg = addParsed({ name: it.name, qty: it.qty, note: it.note || "" }, "typed", helperName());
    done(msg);
    return true;
  }
  function decline(id) {
    const P = pk();
    const i = P ? P.helper.pending.findIndex(x => x.id === id) : -1;
    if (i < 0) return false;
    snap();
    const it = P.helper.pending.splice(i, 1)[0];
    done(`${it.name} is left out.`);
    return true;
  }

  /* ---------------- drawing ---------------- */

  function faceFor(name) {
    try { if (typeof qFaceFor === "function") return qFaceFor(name) || "basket.webp"; } catch (e) { /* fall through */ }
    return "basket.webp";
  }

  function srcChip(r) {
    switch (r.src) {
      case "carried": return "Left from last trip";
      case "queued": return r.from ? `From @${r.from}'s haul` : "From a haul";
      case "added": return r.by ? `Added by ${r.by}` : "Added";
      case "typed": return r.by ? `Added by ${r.by}` : "You added";
      case "starter": return "You added";
      case "usual": return "Usual here";
      case "due": return "Due now";
      default: return "";
    }
  }

  /* One bag row. A tick, the name, a x2 chip, the note and brand, a
   * source chip, an aisle chip, a 44pt Edit button, and (list rows
   * only) the existing x. */
  function rowHtml(key, row, o) {
    const opts = o || {};
    const on = !!row.on;
    const name = opts.name || row.name;
    const sub = [row.note, row.variant].filter(Boolean).join(" · ");
    const aisle = row.aisle || aisleFor(name);
    const chips = [srcChip(row), aisle].filter(Boolean)
      .map((c, i) => `<span class="packchip${i === 0 && srcChip(row) ? " src" : ""}">${esc(c)}</span>`).join("");
    const lock = locked();
    return `<div class="planrow packrow${on ? " in" : ""}"><button class="plantick" data-plan="${esc(key)}" aria-pressed="${String(on)}" type="button">
      <span class="planbox" aria-hidden="true">${on ? "✓" : ""}</span>
      <span class="grow"><span class="name">${esc(name)}</span>${row.qty > 1 ? `<span class="packx">x${esc(row.qty)}</span>` : ""}
      ${sub ? `<span class="sub packnote">${esc(sub)}</span>` : ""}
      ${opts.note ? `<span class="sub">${esc(opts.note)}</span>` : ""}
      ${chips ? `<span class="packchips">${chips}</span>` : ""}</span></button>
      <button class="packedit" data-packedit="${esc(key)}" aria-label="Edit ${esc(name)}" type="button">Edit</button>
      ${opts.itemId ? `<button class="planrm" data-planrm="${esc(key)}" data-item="${esc(opts.itemId)}" aria-label="Remove ${esc(name)} from your list"${lock ? ' aria-disabled="true"' : ""} type="button">✕</button>` : ""}</div>`;
  }

  /* The sections quest.js cannot draw: items from outside the list.
   * pos "top": left from last trip, then a friend's haul.
   * pos "bottom": added for this trip, then Skipped (collapsed). */
  function sectionsHtml(pos) {
    const P = pk();
    if (!P || !D) return "";
    const rows = allRows();
    const sect = (title, body) => body ? `<h3 class="sect">${esc(title)}</h3><div class="group">${body}</div>` : "";
    const extras = rows.filter(r => r.extra && !r.skipped);
    if (pos === "top") {
      const car = extras.filter(r => r.src === "carried");
      const que = extras.filter(r => r.src === "queued");
      const froms = [...new Set(que.map(r => r.from).filter(Boolean))];
      const qTitle = froms.length === 1 ? `From @${froms[0]}'s haul` : "From a friend's haul";
      return sect(`Left from last trip · ${car.length}`, car.map(r => rowHtml(r.key, r)).join("")) +
        sect(`${qTitle} · ${que.length}`, que.map(r => rowHtml(r.key, r)).join(""));
    }
    const mine = extras.filter(r => r.src !== "carried" && r.src !== "queued");
    let html = sect(`Added for this trip · ${mine.length}`, mine.map(r => rowHtml(r.key, r)).join(""));
    const skipped = rows.filter(r => r.skipped);
    if (skipped.length) {
      const open = !!P.expanded.skipped;
      html += `<h3 class="sect">Skipped · ${skipped.length}</h3><div class="group packskipped">
        <button class="packlink packfold" data-packfold="skipped" aria-expanded="${String(open)}" type="button">${open ? "Hide skipped items" : `Show ${skipped.length} skipped ${plural(skipped.length, "item", "items")}`}</button>
        ${open ? skipped.map(r => `<div class="planrow packrow"><span class="grow packskipname"><span class="name">${esc(r.name)}</span>${r.qty > 1 ? `<span class="packx">x${esc(r.qty)}</span>` : ""}</span>
          <button class="packback" data-packrestore="${esc(r.key)}" aria-label="Pack ${esc(r.name)}" type="button">+ Pack</button></div>`).join("") : ""}</div>`;
    }
    return html;
  }

  function emptyBagHtml() {
    const hist = PLAN && PLAN.has_history;
    const empty = t => `<p class="empty">${esc(t)}</p>`;
    return `<div class="group">${empty(hist
      ? "Your bag is empty. Add something above or bring back a skipped item."
      : "Your bag is empty. Type what you need above.")}</div>`;
  }

  function cardHtml(c, i, n) {
    return `<div class="packcard" id="pack-card" data-card="${esc(c.id)}" tabindex="0" role="group"
      aria-label="${esc(c.name)}. Card ${i + 1} of ${n}. Press the right arrow to pack it. Press the left arrow to skip it.">
      <span class="packchip src">${esc(c.chip)}</span>
      <img class="packart" src="assets/characters/${esc(faceFor(c.name))}" alt="">
      <h3>${esc(c.name)}</h3>
      <p class="packwhy">${esc(reasonFor(c))}</p>
      <span class="packqty" role="group" aria-label="Quantity"><button type="button" data-packq="-1" aria-label="One less">−</button><b aria-live="polite">${esc(c.qty || 1)}</b><button type="button" data-packq="1" aria-label="One more">+</button></span>
    </div>`;
  }

  function helperHtml() {
    const P = pk();
    if (!P || !HELPER_ENABLED) return "";
    const on = P.helper.on;
    let html = `<div class="helperbar"><button class="packtoggle" data-packhelper="toggle" aria-pressed="${String(on)}" type="button"><i aria-hidden="true"></i>Helper mode</button>
      <span class="packhint">${on ? "Helper adds wait for your OK." : "Let a child add items. You say yes or no."}</span></div>`;
    if (on) {
      html += `<label class="field packhelpername" for="nl-helpername">Helper name
        <input type="text" id="nl-helpername" maxlength="24" autocomplete="off" placeholder="Mia" value="${esc(P.helper.name)}"></label>`;
      html += P.helper.pending.map(p => `<div class="pendingrow"><span class="grow"><b>${esc(helperName())}</b> wants: ${esc(p.name)}${p.qty > 1 ? ` x${esc(p.qty)}` : ""}${p.note ? ` <span class="packnote">${esc(p.note)}</span>` : ""}</span>
        <button class="packback" data-packdecline="${esc(p.id)}" type="button">No thanks</button>
        <button class="packback yes" data-packapprove="${esc(p.id)}" type="button">Approve</button></div>`).join("");
      html += `<p class="packhint">Turn off helper mode to start.</p>`;
    }
    return html;
  }

  function starterHtml() {
    const have = new Set(allRows().filter(r => r.on).map(r => squashName(r.name)));
    const chips = STARTERS.filter(n => !have.has(squashName(n)))
      .map(n => `<button class="chip packstarter" data-packstarter="${esc(n)}" type="button">+ ${esc(n)}</button>`).join("");
    return `<div class="packfirst"><h3>Start your list</h3>
      <p class="muted">No receipts yet. Type what you need above. After your first receipt, Arya deals cards for you.</p>
      ${chips ? `<p class="packchips" aria-label="Common starters">${chips}</p>` : ""}
      <button class="packlink" data-packscan="1" type="button">Scan an old receipt</button></div>`;
  }

  /* #nl-deck: the card, or the first-run start, or a short note. */
  function paintDeck() {
    const box = qEl("#nl-deck");
    const hbox = qEl("#nl-helper");
    if (hbox) hbox.innerHTML = helperHtml();
    if (!box) return;
    const P = pk();
    if (!P) { box.innerHTML = ""; return; }
    const old = qEl("#pack-card");
    const n = P.deck.length;
    const c = P.deck[P.deal];
    const lock = locked();
    let html = "";
    if (c) {
      const left = n - P.deal;
      html = `<div class="packhead"><span class="packcount" aria-live="polite">Card ${P.deal + 1} of ${n}</span></div>
        <div class="packlinks">
          ${P.decisions.length ? `<button class="packlink" data-pack="back" type="button">Back one card</button>` : `<span></span>`}
          <span class="packlinkgroup"><button class="packlink" data-pack="all"${lock ? ' aria-disabled="true"' : ""} type="button">Pack all ${left}</button>
          <button class="packlink" data-pack="rest"${lock ? ' aria-disabled="true"' : ""} type="button">Skip the rest</button></span></div>
        <div class="packdeck">${cardHtml(c, P.deal, n)}</div>
        <div class="packbtns"><button class="packbtn skip" data-pack="skip" type="button">Skip</button><button class="packbtn pack" data-pack="pack" type="button">Pack it</button></div>`;
    } else if (n && P.decisions.length) {
      html = `<div class="packhead"><span class="packcount">That was the last card. Your bag is below.</span></div>
        <div class="packlinks"><button class="packlink" data-pack="back" type="button">Back one card</button><span></span></div>`;
    } else if (!(PLAN && PLAN.has_history)) {
      html = starterHtml();
    }
    box.innerHTML = html;
    box.hidden = !html;
    if (LEAVE && old && typeof old.removeAttribute === "function" && !reduced()) {
      const deck = box.querySelector(".packdeck");
      if (deck && deck.appendChild) {
        old.removeAttribute("id");
        old.setAttribute("aria-hidden", "true");
        old.classList.add("leaving");
        deck.appendChild(old);
        const dir = LEAVE;
        const go = () => { old.style.transform = ""; old.classList.add(dir === "r" ? "out-r" : "out-l"); };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(go); else go();
        setTimeout(() => { if (old.remove) old.remove(); }, ANIM_MS + 40);
      }
    }
    LEAVE = null;
    bindDrag();
    // The old card is gone. After a key press, put focus on the new
    // card so the next arrow key works.
    if (KEYFOCUS) {
      const next = qEl("#pack-card") || qEl('[data-pack="back"]');
      if (next && next.focus) { try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); } }
    }
  }

  function paintFoot() {
    const box = qEl("#nl-foot");
    save();
    if (!box) return;
    const P = pk();
    const rows = pickedRows();
    const est = estimate(rows, PLAN, STORE);
    const line = estimateLine(est);
    if (!P || !line) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="packestimate" id="nl-estimate">${esc(line)}</p>
      <div class="budgetrow"><label for="nl-budget">Budget for this trip (optional)</label>
      <input type="text" id="nl-budget" inputmode="decimal" autocomplete="off" placeholder="$" value="${esc(P.budget)}"></div>
      <p class="budgetline" id="nl-budgetline" role="status">${esc(budgetLine(est.total, P.budget))}</p>`;
  }
  function paintBudgetLine() {
    const P = pk();
    const el = qEl("#nl-budgetline");
    if (!P || !el) return;
    el.textContent = budgetLine(estimate(pickedRows(), PLAN, STORE).total, P.budget);
  }
  function setBudget(v) {
    const P = pk();
    if (!P) return;
    P.budget = String(v || "").replace(/[^0-9.]/g, "").slice(0, 7);
    if (P.budget) lsSet(KEY_BUDGET, P.budget); else lsDel(KEY_BUDGET);
    paintBudgetLine();
  }

  /* Pending list rows and lone typed text count toward Start. */
  function startCount() {
    const box = qEl("#nl-text");
    const typed = box ? splitInput(box.value).length : 0;
    return pickedRows().length + typed;
  }
  function syncStart() {
    const btn = qEl("#nl-next");
    if (!btn) return;
    const n = startCount();
    const off = n === 0 || locked();
    btn.textContent = n ? `Start the quest · ${n} ${plural(n, "item", "items")} →` : "Add an item to start";
    btn.setAttribute("aria-disabled", off ? "true" : "false");
    return n;
  }
  function startBlocked() {
    if (locked()) { say("Helper mode is on. Turn it off to start."); return true; }
    return false;
  }

  /* ---------------- drag, keys, and clicks ---------------- */

  function bindDrag() {
    const el = qEl("#pack-card");
    if (!el || !el.addEventListener) return;
    let x0 = null, dx = 0, id = null;
    const tilt = !reduced();
    el.addEventListener("pointerdown", e => {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      x0 = e.clientX; dx = 0; id = e.pointerId;
      el.classList.add("drag");
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    el.addEventListener("pointermove", e => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      el.style.transform = tilt ? `translateX(${dx}px) rotate(${dx / 20}deg)` : `translateX(${dx}px)`;
    });
    const end = () => {
      if (x0 === null) return;
      x0 = null;
      el.classList.remove("drag");
      const w = el.getBoundingClientRect ? el.getBoundingClientRect().width : 300;
      const d = dragDecision(dx, w);
      if (d) decide(d, el.dataset.card);
      else el.style.transform = "";
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function onClick(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest("[data-pack],[data-packq],[data-packedit],[data-packrestore],[data-packfold],[data-packstarter],[data-packscan],[data-packhelper],[data-packapprove],[data-packdecline]") : null;
    if (!t || !D) return;
    const d = t.dataset;
    if (t.getAttribute("aria-disabled") === "true") { lockedSay(); return; }
    if (d.pack) {
      const card = pk() && pk().deck[pk().deal];
      if (d.pack === "pack" || d.pack === "skip") { if (card) decide(d.pack, card.id); }
      else if (d.pack === "back") back();
      else if (d.pack === "all") packAll();
      else if (d.pack === "rest") skipRest();
    } else if (d.packq) setCardQty(Number(d.packq));
    else if (d.packedit) openEdit(d.packedit, t);
    else if (d.packrestore) restore(d.packrestore);
    else if (d.packfold) { const P = pk(); P.expanded.skipped = !P.expanded.skipped; render(); save(); }
    else if (d.packstarter) addStarter(d.packstarter);
    else if (d.packscan) {
      // Old receipts are filed from the List tab.
      const tab = qEl('#tabs button[data-view="view-list"]');
      if (tab && tab.click) tab.click();
    } else if (d.packhelper) setHelper(!locked());
    else if (d.packapprove) approve(d.packapprove);
    else if (d.packdecline) decline(d.packdecline);
  }
  function onKey(ev) {
    if (!pk() || !ev.target) return;
    const tag = String(ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (!(ev.target.closest && ev.target.closest("#nl-deck"))) return;
    const card = pk().deck[pk().deal];
    if (!card) return;
    const kind = ev.key === "ArrowRight" ? "pack" : ev.key === "ArrowLeft" ? "skip" : null;
    if (!kind) return;
    ev.preventDefault();
    KEYFOCUS = true;
    try { decide(kind, card.id); } finally { KEYFOCUS = false; }
  }
  function onInput(ev) {
    const t = ev.target;
    if (!t || !D) return;
    if (t.id === "nl-budget") setBudget(t.value);
    else if (t.id === "nl-helpername") setHelperName(t.value);
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("input", onInput);
  }

  /* ---------------- the Edit sheet ---------------- */

  let EDIT = null;   // {key, opener, dirty, wrap}

  function removeFromTrip(key) {
    const r = D && D.pick[key];
    if (!r) return;
    if (r.extra) delete D.pick[key]; else { r.on = false; }
  }
  function editHtml(key) {
    const r = D.pick[key];
    const showAisle = r.extra && (r.src === "typed" || r.src === "starter");
    return `<div class="sheet packsheet" role="dialog" aria-modal="true" aria-labelledby="pack-edit-title">
      <h3 id="pack-edit-title">${esc(r.name)}</h3>
      <div class="packfield"><span class="packlabel" id="pack-q-label">Quantity</span>
        <span class="packqty" role="group" aria-labelledby="pack-q-label"><button type="button" data-edit="qty-" aria-label="One less">−</button><b id="pack-edit-qty" aria-live="polite">${esc(r.qty || 1)}</b><button type="button" data-edit="qty+" aria-label="One more">+</button></span></div>
      <label class="packfield" for="pack-edit-note"><span class="packlabel">Note</span>
        <input type="text" id="pack-edit-note" maxlength="60" autocomplete="off" placeholder="Size, ripeness, a reminder" value="${esc(r.note || "")}"></label>
      <div class="packfield"><span class="packlabel">Brand</span>
        <span class="packchips" id="pack-edit-brands"><button type="button" class="chip" data-edit="brand" data-brand="" aria-pressed="${String(!r.variant)}">Any brand</button></span>
        <input type="text" id="pack-edit-variant" maxlength="60" autocomplete="off" placeholder="Other brand" aria-label="Other brand" value="${esc(r.variant || "")}"></div>
      ${showAisle ? `<div class="packfield"><span class="packlabel">Aisle</span><span class="packchips">${AISLES.map(a => `<button type="button" class="chip" data-edit="aisle" data-aisle="${esc(a)}" aria-pressed="${String(r.aisle === a)}">${esc(a)}</button>`).join("")}</span></div>` : ""}
      <div class="packsheetbtns"><button type="button" class="packlink" data-edit="remove">Take out of this trip</button>
      <button type="button" class="packbtn pack" data-edit="done">Done</button></div></div>`;
  }
  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])"))
      .filter(e => !e.disabled);
  }
  function openEdit(key, opener) {
    if (!D || !D.pick[key] || typeof document === "undefined" || !document.body || !document.body.appendChild) return false;
    closeEdit(true);
    snap();
    const wrap = document.createElement("div");
    wrap.className = "sheetwrap packsheetwrap";
    wrap.id = "pack-sheet";
    wrap.innerHTML = editHtml(key);
    document.body.appendChild(wrap);
    EDIT = { key, opener: opener || document.activeElement, dirty: false, wrap, snapDepth: SNAPS.length };
    wrap.addEventListener("click", e => {
      if (e.target === wrap) { closeEdit(); return; }
      const b = e.target.closest && e.target.closest("[data-edit]");
      if (b) onEditClick(b);
    });
    wrap.addEventListener("input", e => {
      const r = D.pick[key];
      if (!r) return;
      if (e.target.id === "pack-edit-note") { r.note = clip(e.target.value, 60); touch(); }
      else if (e.target.id === "pack-edit-variant") { r.variant = clip(e.target.value, 60); markBrands(); touch(); }
    });
    wrap.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); closeEdit(); return; }
      if (e.key === "Tab") {
        const f = focusables(wrap);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    const doneBtn = wrap.querySelector('[data-edit="done"]');
    if (doneBtn && doneBtn.focus) doneBtn.focus();
    loadBrands(key);
    return true;
  }
  function touch() { if (EDIT) EDIT.dirty = true; renderBehind(); }
  function renderBehind() {
    // Draw the bag behind the sheet without losing the sheet.
    if (typeof renderPlan === "function" && D && D.store) renderPlan();
    else { paintFoot(); syncStart(); }
    save();
  }
  function markBrands() {
    if (!EDIT) return;
    const r = D.pick[EDIT.key];
    EDIT.wrap.querySelectorAll("[data-brand]").forEach(b => {
      b.setAttribute("aria-pressed", String((b.dataset.brand || "") === (r.variant || "")));
    });
  }
  async function loadBrands(key) {
    const r = D.pick[key];
    if (!r || typeof api !== "function") return;
    try {
      const out = await api("/api/pack/variants?name=" + encodeURIComponent(r.name));
      if (!EDIT || EDIT.key !== key) return;
      const box = EDIT.wrap.querySelector("#pack-edit-brands");
      if (!box) return;
      const add = (out.variants || []).slice(0, 6).map(v =>
        `<button type="button" class="chip" data-edit="brand" data-brand="${esc(v.name)}" aria-pressed="${String((D.pick[key].variant || "") === v.name)}">${esc(v.name)}</button>`).join("");
      box.insertAdjacentHTML("beforeend", add);
    } catch (e) { /* offline: the custom field still works */ }
  }
  function onEditClick(b) {
    const r = EDIT && D.pick[EDIT.key];
    if (!r) return;
    const a = b.dataset.edit;
    if (a === "qty-" || a === "qty+") {
      r.qty = Math.min(99, Math.max(1, (r.qty || 1) + (a === "qty+" ? 1 : -1)));
      const n = EDIT.wrap.querySelector("#pack-edit-qty");
      if (n) n.textContent = String(r.qty);
      touch();
    } else if (a === "brand") {
      r.variant = b.dataset.brand || "";
      const f = EDIT.wrap.querySelector("#pack-edit-variant");
      if (f) f.value = r.variant || "";
      markBrands(); touch();
    } else if (a === "aisle") {
      r.aisle = r.aisle === b.dataset.aisle ? "" : b.dataset.aisle;
      EDIT.wrap.querySelectorAll("[data-aisle]").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.aisle === r.aisle)));
      touch();
    } else if (a === "remove") {
      const name = r.name, key = EDIT.key;
      removeFromTrip(key);
      EDIT.dirty = true;
      closeEdit(false, `${name} is out of this trip.`);
    } else if (a === "done") closeEdit();
  }
  /* Close the sheet. quiet = no toast and no snapshot kept. */
  function closeEdit(quiet, msg) {
    if (!EDIT) return;
    const { wrap, opener, dirty, snapDepth } = EDIT;
    EDIT = null;
    if (wrap.remove) wrap.remove();
    if (quiet) { if (!dirty) SNAPS.length = Math.min(SNAPS.length, snapDepth - 1); }
    else if (dirty) done(msg || "Saved.");
    else SNAPS.length = Math.min(SNAPS.length, snapDepth - 1);
    if (opener && opener.focus && typeof document !== "undefined" && document.contains && document.contains(opener)) opener.focus();
    else if (!quiet) { const e = qEl("#nl-next"); if (e && e.focus) e.focus(); }
  }

  /* ---------------- hand-off to quest.js ---------------- */

  /* Payloads for /api/list/add: typed and starter items join the
   * Arya list at Start (one list everywhere). Left-over and haul
   * items never do. */
  function listJoins() {
    const out = [];
    for (const r of pickedRows()) {
      if (r.extra && r.joinList) {
        const body = r.itemId ? { item_id: r.itemId } : { name: r.name };
        if (r.qty > 1) body.qty = r.qty;
        if (r.by) body.by = r.by;
        // The grown-up said yes: the list keeps it, and the next
        // plan does not deal it again.
        if (r.approved) body.approved = true;
        out.push(body);
      } else if (r.src === "added" && r.itemId) {
        // A helper's list row that the grown-up packed.
        out.push({ item_id: r.itemId, approved: true });
      }
    }
    return out;
  }

  return {
    // pure logic
    parseLine, splitInput, aisleFor, matchRow, exactRow, buildDeck, reasonFor, dragDecision,
    estimate, estimateLine, budgetLine, rawItem, sessionItem, extrasOf, norm, squashName,
    AISLES, STARTERS,
    // state machine
    open, reset, finish, decide, back, packAll, skipRest, restore, undo,
    addFromText, addStarter, afterBulkAdd, flush, approve, decline, setHelper, setHelperEnabled,
    // drawing and wiring
    rowHtml, sectionsHtml, emptyBagHtml, paintDeck, paintFoot, syncStart, startBlocked,
    holds, locked, listJoins, openEdit, closeEdit, setBudget, setHelperName,
    // reads
    rows: pickedRows, startCount, remaining,
    busy: () => BUSY,
    state: () => ({ draft: D, pack: pk(), plan: PLAN, store: STORE, snaps: SNAPS.length }),
    // test seams
    _onKey: onKey,
    _settle: () => { BUSY = false; clearTimeout(BUSY_T); },
    _storage: { key: KEY_DRAFT, budget: KEY_BUDGET, helper: KEY_HELPER },
  };
})();
window.PACK = PACK;
