import { useEffect, useReducer, useRef, useState, type ChangeEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { get, post } from "../lib/api";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import { clearOnSignOut } from "../app/session";
import { asset } from "../lib/format";
import { faceFor, loadCharacters } from "../lib/characters";

/* Port of pwa/index.html #view-newlist, the plan half of quest.js
 * (renderPlan, qNl*, nl-next, qFastStart, qLoadPlan, qLoadMissing)
 * and the whole Pack module (pwa/pack.js: the dealt-card deck, bag
 * rows, Edit sheet, estimate and budget). Helper mode is hidden in
 * the old app (HELPER_ENABLED = false), so it is not ported; the saved
 * draft keeps its `helper` field so old and new drafts interchange.
 *
 * Entry: nav.show("newlist", { store, storeId?, fromList?, fastMode? })
 * (what the store picker's qPickStore set on Q.draft).
 * Exit: Start runs /api/quest/optimize, then nav.show("mode" | "optimize",
 * { draft }) with the old Q.draft shape (see NewListDraft). The draft is
 * kept per params object, so Back from those screens returns to the
 * same plan. The voice recorder is lib/recorder.ts (shared with Ask);
 * the Pack logic below is local.
 *
 * fastMode ("Start shopping" on a list): the old qOptimizeDraft and
 * the Check-my-list screen created the session at once
 * (qCreateSession(fastMode)) instead of showing the mode screen. Here
 * the draft goes to "mode"/"optimize" with draft.fastMode still set;
 * those screens must honour it when they are ported. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------------- phone storage, never fatal (pack.js) ---------------- */

const KEY_DRAFT = "arya-pack-draft";
const KEY_BUDGET = "arya-pack-budget";
const KEY_HELPER = "arya-helper-name";
const DRAFT_MAX_AGE = 12 * 3600 * 1000;
const UNDO_DEPTH = 20;
const DECK_CAP = 12;
const ANIM_MS = 220;
const STARTERS = ["Eggs", "Milk", "Bananas", "Bread"];
const AISLES = ["Produce", "Bakery", "Deli", "Dairy", "Pantry", "Frozen", "Household"];

const MEM: Record<string, string> = {};
function lsGet(k: string): string | null {
  try { const v = localStorage.getItem(k); return v === undefined ? null : v; } catch { /* blocked: use memory */ }
  return k in MEM ? MEM[k] : null;
}
function lsSet(k: string, v: unknown) {
  MEM[k] = String(v);
  try { localStorage.setItem(k, String(v)); } catch { /* kept in memory */ }
}
function lsDel(k: string) {
  delete MEM[k];
  try { localStorage.removeItem(k); } catch { /* nothing to do */ }
}

/* ---------------- types ---------------- */

type Pick = {
  name: string; qty: number; on: boolean; skipped?: boolean; extra?: boolean; src?: string;
  aisle?: string; note?: string; variant?: string; by?: string; itemId?: string; joinList?: boolean;
  queuedId?: string; from?: string; unit?: string; approved?: boolean;
};
type Card = {
  id: string; key: string; name: string; qty: number; kind: string; src: string; chip: string;
  note?: string; variant?: string; by?: string; aisle?: string; queued_id?: string; from?: string;
  itemId?: string; every_days?: number | null; days_since?: number | null; typical_qty?: number | null; here?: number;
};
type Pack = {
  v: 1; store: string; deck: Card[]; deal: number;
  decisions: { cardId: string; kind: string; key: string; had: Pick | null }[];
  expanded: { bag: boolean; skipped: boolean };
  helper: { on: boolean; name: string; pending: unknown[] };
  budget: string; satisfied?: string[];
};
type ListRow = {
  name: string; qty?: number; unit?: string; added_by?: string; approved?: boolean; source?: string; item_id?: string;
  history_id?: string; list?: string; on_list?: boolean; checked?: boolean;
};
type PlanItem = {
  name: string; item_id?: string; stores?: Record<string, number>; prices?: Record<string, number>; price?: number;
  due?: boolean; every_days?: number; days_since?: number; typical_qty?: number;
};
type Plan = { list: ListRow[]; items: PlanItem[]; has_history?: boolean; carried?: any[]; queued?: any[] };
type FromList = { id: string; name: string; stores: string[] };
type Line = { name: string; qty: number; [k: string]: unknown };

/* The old Q.draft, handed on to the optimize and mode screens. */
export type NewListDraft = {
  raw: Line[]; store: string; storeId?: string | null; opt: any; baseItems: any[];
  undone: Record<string, unknown>; answers: Record<string, unknown>; pick: Record<string, Pick>;
  fromList: FromList | null; fastMode: string | null;
  plan?: Plan; pack?: Pack | null; missing?: Set<string>; creating?: boolean;
  qQty?: Record<string, number>; finalItems?: any[]; fastDone?: boolean;
};

/* ---------------- small helpers (own copies) ---------------- */

const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function squash(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const squashName = (s: unknown) => norm(s).split(" ").filter(Boolean).map(squash).join(" ");
function sameStore(a: unknown, b: unknown) {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
}
const storeCount = (stores: Record<string, number> | undefined, store: string) =>
  Object.entries(stores || {}).reduce((n, [s, c]) => n + (sameStore(s, store) ? c : 0), 0);
const titleCase1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
function reduced() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { return false; }
}
const clip = (v: unknown, n: number) => String(v == null ? "" : v).trim().slice(0, n).trim();
const qSing = (s: unknown) => norm(s).replace(/s$/, "");

/* ---------------- parsing what the shopper types ---------------- */

/* quest.js qParseLines / qParseText */
function parseLines(text: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of String(text || "").split("\n")) {
    const s = rawLine.trim();
    if (!s) continue;
    let m = s.match(/^(\d+)\s*[x×]?\s+(.+)$/);
    if (m) { out.push({ name: m[2].trim(), qty: Number(m[1]) }); continue; }
    m = s.match(/^(.+?)\s*[x×]\s*(\d+)$/);
    if (m) { out.push({ name: m[1].trim(), qty: Number(m[2]) }); continue; }
    out.push({ name: s, qty: 1 });
  }
  return out;
}
function parseText(text: string): Line[] {
  const LEAD = /^(i need( some)?|we need( some)?|i want( some)?|get me|get|buy|add|please add|please get)\s+/i;
  const FILL = /^(oh|okay|ok|so|well|um|uh|hmm)[,\s]+/i;
  const frags: string[] = [];
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/,/.test(line) && !LEAD.test(line)) { frags.push(line); continue; }
    const body = line.replace(LEAD, "").replace(/[.!]+$/, "");
    for (const part of body.split(/\s*,\s*/)) {
      for (const bit of part.split(/\s+and\s+/i)) {
        let b = bit.trim().replace(/[.!]+$/, "");
        for (let i = 0; i < 3; i++) {
          const nb = b.replace(FILL, "").replace(LEAD, "").replace(/^some\s+/i, "");
          if (nb === b) break;
          b = nb;
        }
        if (b && !/^(oh|okay|ok|so|well|um|uh|hmm)$/i.test(b)) frags.push(b);
      }
    }
  }
  const seen = new Set<string>(), out: Line[] = [];
  for (const item of parseLines(frags.join("\n"))) {
    const k = norm(item.name);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(item);
  }
  return out;
}

const SIZE_RE = new RegExp(
  "(?:^|\\s)(\\d+(?:\\.\\d+)?\\s*(?:fl\\s*oz|oz|lbs?|pounds?|kg|mg|g|ml|lt|ltr|liters?|litres?|l|ct|count|pk|pack|dozen|doz|gal|gallons?|qt|quarts?|pt|pints?)|dozen|doz)(?=\\s|$)", "i");
const NUMERIC_BRANDS = ["7 up", "7up", "5 alive", "100 grand", "3 musketeers", "5 hour energy"];

/* "2x tortillas", "tortillas x2", "salsa 16oz" -> {name, qty, note}. */
export function parseLine(text: unknown) {
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
    let q: RegExpMatchArray | null;
    if ((q = s.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i)) || (q = s.match(/^(\d{1,2})\s+(.+)$/))) {
      qty = Number(q[1]); s = q[2].trim();
    } else if ((q = s.match(/^(.+?)\s+[x×]\s*(\d{1,2})$/i)) || (q = s.match(/^(.+?)\s+(\d{1,2})\s*[x×]$/i)) ||
               (q = s.match(/^(.+?)\s+(\d{1,2})$/))) {
      qty = Number(q[2]); s = q[1].trim();
    }
    if (qty < 1) qty = 1;
  }
  if (!s) { s = note; note = ""; }
  return { name: titleCase1(s), qty, note };
}

/* Newline, then ";", then sentences. */
export function splitInput(text: string): string[] {
  const lines = String(text == null ? "" : text).split(/[\n;]+/).map(p => p.trim()).filter(Boolean);
  return lines.flatMap(l => {
    if (!/,/.test(l) && !/^(i need|we need|get me|get|buy|add|please add|please get)\s/i.test(l)) return [l];
    return parseText(l).map(it => (it.qty > 1 ? it.qty + "x " : "") + it.name);
  });
}

const AISLE_WORDS: [string, string[]][] = [
  ["Frozen", ["frozen", "ice cream", "popsicle", "gelato", "sorbet", "waffles"]],
  ["Household", ["paper towel", "toilet paper", "tissue", "detergent", "dish soap", "soap", "trash bag", "sponge", "foil", "bleach", "diaper", "wipes", "shampoo", "toothpaste", "napkin", "cleaner", "laundry", "batteries", "light bulb"]],
  ["Pantry", ["peanut butter", "almond butter", "egg noodle", "pasta sauce", "tomato sauce"]],
  ["Dairy", ["milk", "cheese", "yogurt", "yoghurt", "butter", "egg", "cream", "kefir", "cottage", "half and half", "creamer"]],
  ["Bakery", ["bread", "bagel", "tortilla", "bun", "roll", "muffin", "croissant", "baguette", "pita", "cake", "donut", "naan"]],
  ["Deli", ["ham", "turkey", "salami", "deli", "prosciutto", "hummus", "bacon", "sausage", "rotisserie", "pastrami"]],
  ["Pantry", ["pasta", "spaghetti", "noodle", "rice", "cereal", "oats", "oatmeal", "granola", "flour", "sugar", "olive oil", "oil", "vinegar", "sauce", "salsa", "ketchup", "mustard", "mayo", "beans", "canned", "soup", "broth", "coffee", "tea", "honey", "jam", "nuts", "almonds", "cracker", "chips", "popcorn", "snack", "spice", "salt", "cookies", "chocolate", "syrup", "tuna"]],
  ["Produce", ["apple", "banana", "berry", "strawberry", "blueberry", "raspberry", "grape", "orange", "lemon", "lime", "avocado", "tomato", "onion", "garlic", "potato", "carrot", "lettuce", "spinach", "kale", "salad", "cucumber", "pepper", "broccoli", "cauliflower", "celery", "mushroom", "cilantro", "parsley", "basil", "herb", "fruit", "vegetable", "melon", "mango", "pear", "peach", "zucchini", "squash", "corn", "ginger", "pineapple"]],
];
const AISLE_PADDED = AISLE_WORDS.map(([label, words]) => [label, words.map(w => " " + squashName(w) + " ")] as const);
export function aisleFor(name: string) {
  const hay = " " + squashName(name) + " ";
  if (hay.trim() === "") return "";
  for (const [label, words] of AISLE_PADDED) if (words.some(w => hay.includes(w))) return label;
  return "";
}
function coreName(s: unknown) {
  const g = new RegExp(SIZE_RE.source, "gi");
  return squashName(String(s || "").replace(g, " "));
}
export function exactRow<T extends { name: string }>(name: string, rows: T[]): T | null {
  const t = squashName(name);
  if (!t) return null;
  for (const r of rows || []) if (squashName(r.name) === t) return r;
  return null;
}
export function matchRow<T extends { name: string }>(name: string, rows: T[]): T | null {
  const exact = exactRow(name, rows);
  if (exact) return exact;
  const t = coreName(name);
  if (!t) return null;
  const hits = (rows || []).filter(r => coreName(r.name) === t);
  return hits.length === 1 ? hits[0] : null;
}

/* ---------------- the deck ---------------- */

const cardId = (kind: string, key: string) => kind + ":" + key;

export function buildDeck(o: { plan: Plan; store: string; pick: Record<string, Pick> }): Card[] & { satisfied?: string[] } {
  const plan = o.plan || ({} as Plan);
  const store = o.store || "";
  const pick = o.pick || {};
  const carried = plan.carried || [];
  const queued = plan.queued || [];
  const list = plan.list || [];
  const seen = new Set<string>();
  for (const r of list) seen.add(squashName(r.name));
  for (const k of Object.keys(pick)) seen.add(squashName((pick[k] && pick[k].name) || k));
  const cards: Card[] & { satisfied?: string[] } = [];
  const add = (c: Card) => {
    const sq = squashName(c.name);
    if (!sq || seen.has(sq) || cards.length >= DECK_CAP) return;
    seen.add(sq);
    cards.push(c);
  };
  for (const c of carried) {
    if (!c || !c.name) continue;
    add({ id: cardId("carried", norm(c.name)), key: norm(c.name), name: c.name, qty: Math.max(1, Number(c.qty) || 1),
      kind: "carried", src: "carried", chip: "Left from last trip",
      note: c.note || "", variant: c.variant || "", by: c.by || "", aisle: c.aisle || "" });
  }
  const satisfied: string[] = [];
  for (const q of queued) {
    if (!q || !q.name) continue;
    const from = String(q.from || "").replace(/^@/, "");
    if (q.id && seen.has(squashName(q.name))) { satisfied.push(q.id); continue; }
    add({ id: cardId("queued", norm(q.name)), key: norm(q.name), name: q.name, qty: Math.max(1, Number(q.qty) || 1),
      kind: "queued", src: "queued", queued_id: q.id, from,
      chip: from ? `From @${from}'s haul` : "From a friend's haul" });
  }
  for (const r of list) {
    if (!r.added_by || r.approved) continue;
    const key = norm(r.name);
    if (key in pick) continue;
    if (cards.some(c => squashName(c.name) === squashName(r.name))) continue;
    seen.delete(squashName(r.name));
    add({ id: cardId("added", key), key, name: r.name, qty: Math.max(1, Number(r.qty) || 1),
      kind: "added", src: "added", by: r.added_by, itemId: r.item_id, chip: `Added by ${r.added_by}` });
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

export function reasonFor(c: Card) {
  if (!c) return "";
  if (c.kind === "carried") return "Left from last trip.";
  if (c.kind === "queued") return c.from ? `From @${c.from}'s haul.` : "From a friend's haul.";
  if (c.kind === "added") return `${c.by || "Someone"} added this.`;
  const out: string[] = [];
  if (c.every_days) out.push(`You buy this about every ${Math.round(c.every_days)} days.`);
  if (c.days_since != null) out.push(`Last bought ${Math.round(c.days_since)} ${plural(Math.round(c.days_since), "day", "days")} ago.`);
  if (c.typical_qty && c.typical_qty > 1) out.push(`You usually get ${Math.round(c.typical_qty)}.`);
  if (c.here) out.push(`Bought here ${c.here} ${plural(c.here, "time", "times")}.`);
  return out.slice(0, 3).join(" ");
}

export function dragDecision(dx: number, width: number) {
  const t = Math.max(80, 0.25 * (Number(width) || 0));
  if (dx > t) return "pack";
  if (dx < -t) return "skip";
  return null;
}

/* ---------------- the private estimate ---------------- */

function planItemFor(plan: Plan | undefined, row: { name: string; itemId?: string }) {
  const items = (plan && plan.items) || [];
  if (row.itemId) { const hit = items.find(i => i.item_id === row.itemId); if (hit) return hit; }
  const sq = squashName(row.name);
  return items.find(i => squashName(i.name) === sq) || null;
}
export function estimate(rows: { name: string; qty: number; itemId?: string }[], plan: Plan | undefined, store: string) {
  let total = 0, priced = 0;
  for (const r of rows || []) {
    const it = planItemFor(plan, r);
    if (!it) continue;
    let unit: number | null = null;
    for (const [s, p] of Object.entries(it.prices || {})) if (sameStore(s, store) && p > 0) unit = p;
    if (unit == null && (it.price || 0) > 0) unit = it.price!;
    if (unit == null) continue;
    total += unit * Math.max(1, Number(r.qty) || 1);
    priced += 1;
  }
  return { total: Math.round(total * 100) / 100, priced, count: (rows || []).length };
}
export function estimateLine(est: { total: number; priced: number; count: number }) {
  if (!est || !est.priced) return "";
  const t = "$" + Math.round(est.total);
  const part = est.priced === est.count
    ? `your ${est.count} ${plural(est.count, "item", "items")}`
    : `${est.priced} of your ${est.count} items`;
  return `About ${t} for ${part}. Only you see this.`;
}
export function budgetLine(total: number, budget: string) {
  const b = Number(budget);
  if (!(b > 0) || !(total > 0)) return "";
  const over = Math.round(total - b);
  if (over < 1) return "";
  return `About $${over} over your budget. Want to leave something for next trip?`;
}

/* ---------------- session shape ---------------- */

export function rawItem(p: Pick): Line {
  const out: Line = { name: p.name, qty: Math.max(1, Number(p.qty) || 1) };
  const aisle = clip(p.aisle, 60) || aisleFor(p.name);
  if (clip(p.note, 60)) out.note = clip(p.note, 60);
  if (clip(p.variant, 60)) out.variant = clip(p.variant, 60);
  if (clip(p.unit, 16)) out.unit = clip(p.unit, 16);
  if (clip(p.by, 24)) out.by = clip(p.by, 24);
  out.src = p.src || "list";
  if (aisle) out.aisle = aisle;
  return out;
}
export function sessionItem(i: any, extras?: Record<string, unknown>) {
  const out: any = { name: i.name, qty: i.qty };
  if (i.group) out.group = i.group;
  const e: any = extras || {};
  for (const k of ["note", "variant", "by", "src", "aisle", "unit"]) { const v = i[k] || e[k]; if (v) out[k] = v; }
  return out;
}
/* The extras of the first raw line that carries this name (pack.js). */
export function packExtrasOf(raw: Line[] | undefined, name: string) {
  const n = norm(name);
  const hit: any = (raw || []).find(r => norm(r.name) === n);
  const out: Record<string, unknown> = {};
  if (!hit) return out;
  for (const k of ["note", "variant", "by", "src", "aisle", "unit"]) if (hit[k]) out[k] = hit[k];
  return out;
}

/* The session was made: the draft is done (pack.js finish). The mode
 * screen calls this after POST /api/quest/sessions. */
export function packFinish(draft: NewListDraft | null) {
  const P = draft && draft.pack;
  const ids = P && Array.isArray(P.satisfied) ? P.satisfied.slice() : [];
  if (P) P.deck.slice(0, P.deal).forEach(c => { if (c.queued_id && !ids.includes(c.queued_id)) ids.push(c.queued_id); });
  lsDel(KEY_DRAFT);
  if (ids.length) post("/api/quest/queued/finish", { ids }).catch(() => {});
  if (draft) draft.pack = null;
  return ids;
}
export { sessionItem as packSessionItem };

/* ---------------- plan helpers (quest.js) ---------------- */

function planBucket(plan: Plan, li: ListRow, store: string) {
  const id = li.history_id || li.item_id;
  const rec = (plan.items || []).find(i => (id && i.item_id === id) || norm(i.name) === norm(li.name)) || null;
  const total = rec ? Object.values(rec.stores || {}).reduce((a, b) => a + b, 0) : 0;
  if (!total || !rec) return { bucket: "new" as const, here: 0, total: 0, store: "", n: 0 };
  const here = storeCount(rec.stores, store);
  let best = "", bestN = 0;
  for (const [s, n] of Object.entries(rec.stores || {})) {
    if (!sameStore(s, store) && n > bestN) { best = s; bestN = n; }
  }
  if (here && here >= bestN) return { bucket: "here" as const, here, total, store: "", n: 0 };
  return { bucket: "elsewhere" as const, store: best, n: bestN, total, here: 0 };
}

/* The draft survives Back from the screens after this one, keyed by
 * the params object the nav entry keeps. */
let held: { params: object; draft: NewListDraft } | null = null;
clearOnSignOut(() => { held = null; });
function draftFor(params: Record<string, any>): NewListDraft {
  if (held && held.params === params) return held.draft;
  const fl = params.fromList as FromList | undefined;
  const d: NewListDraft = {
    raw: [], store: String(params.store || ""), storeId: params.storeId || null, opt: null, baseItems: [], undone: {}, answers: {}, pick: {},
    fromList: fl ? { id: fl.id, name: fl.name, stores: fl.stores || [] } : null,
    fastMode: (params.fastMode as string) || null,
  };
  held = { params, draft: d };
  return d;
}

function newPack(store: string): Pack {
  return {
    v: 1, store, deck: [], deal: 0, decisions: [],
    expanded: { bag: false, skipped: false },
    helper: { on: false, name: lsGet(KEY_HELPER) || "", pending: [] },
    budget: lsGet(KEY_BUDGET) || "",
  };
}

const NOTE = "Pack what you need. Tap a row to take it in or out.";

export function NewList() {
  const nav = useNav();
  const { toast } = useToast();
  const d = draftFor(nav.params);
  const dRef = useRef(d);
  dRef.current = d;
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [ready, setReady] = useState(!!(d.plan && d.pack));
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const [status, setStatus] = useState("");
  const [listening, setListening] = useState(false);
  const capture = useRef<Capture | null>(null);
  const [creating, setCreating] = useState(false);
  const [leave, setLeave] = useState<{ card: Card; dir: "r" | "l"; go: boolean } | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const snaps = useRef<string[]>([]);
  const busy = useRef(false);
  const busyT = useRef<number | undefined>(undefined);
  const keyFocus = useRef(false);
  const editState = useRef<{ key: string; dirty: boolean; snapDepth: number } | null>(null);
  const drag = useRef<{ x0: number; dx: number } | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const variantRef = useRef<HTMLInputElement>(null);
  const store = d.store;

  /* ---- state helpers (pack.js) ---- */
  const P = () => dRef.current.pack || null;
  const pickedRows = () => Object.entries(dRef.current.pick || {}).filter(([, r]) => r && r.on).map(([key, r]) => ({ key, ...r }));
  const allRows = () => Object.entries(dRef.current.pick || {}).map(([key, r]) => ({ key, ...r }));

  const save = () => {
    const D = dRef.current, pk = D.pack;
    if (!pk) return;
    const worth = pk.deal > 0 || pk.helper.pending.length > 0 || Object.values(D.pick || {}).some(r => r && r.extra);
    if (!worth) return;
    lsSet(KEY_DRAFT, JSON.stringify({ v: 1, t: Date.now(), store, pick: D.pick, pack: pk }));
  };
  const loadSaved = () => {
    const raw = lsGet(KEY_DRAFT);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || o.v !== 1 || !o.pack || o.pack.v !== 1 || !o.pick || typeof o.pick !== "object") return null;
      if (!sameStore(o.store, store) || !(Date.now() - o.t < DRAFT_MAX_AGE)) return null;
      if (!Array.isArray(o.pack.deck) || !Array.isArray(o.pack.decisions) || !o.pack.helper) return null;
      return o as { pick: Record<string, Pick>; pack: Pack };
    } catch { return null; }
  };
  const snap = () => {
    snaps.current.push(JSON.stringify({ pick: dRef.current.pick, pack: dRef.current.pack }));
    if (snaps.current.length > UNDO_DEPTH) snaps.current.shift();
  };
  const settleLater = () => {
    busy.current = true;
    clearTimeout(busyT.current);
    busyT.current = window.setTimeout(() => { busy.current = false; }, reduced() ? 0 : ANIM_MS);
  };

  const undo = () => {
    const s = snaps.current.pop();
    if (!s) { toast("Nothing to undo."); return false; }
    const o = JSON.parse(s);
    dRef.current.pick = o.pick; dRef.current.pack = o.pack;
    busy.current = false;
    closeEdit(true);
    force();
    save();
    toast("Undone.");
    return true;
  };
  /* After a change: draw, save, and offer Undo. */
  const done = (msg?: string, leaving?: { card: Card; dir: "r" | "l" }) => {
    if (leaving && !reduced()) {
      setLeave({ ...leaving, go: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setLeave(l => (l ? { ...l, go: true } : l))));
      window.setTimeout(() => setLeave(null), ANIM_MS + 40);
    }
    force();
    save();
    if (msg) toast(msg, { action: "Undo", onAction: undo });
  };

  const openPack = () => {
    const D = dRef.current;
    const plan = D.plan || { list: [], items: [] };
    if (D.pack && D.pack.v === 1 && sameStore(D.pack.store, store)) return;
    snaps.current = []; busy.current = false;
    const saved = loadSaved();
    if (saved) {
      D.pick = saved.pick;
      D.pack = saved.pack;
      D.pack.budget = lsGet(KEY_BUDGET) || D.pack.budget || "";
      toast("Welcome back. Your bag is saved.", { action: "Start over", onAction: reset });
      return;
    }
    D.pack = newPack(store);
    const deck = buildDeck({ plan, store, pick: D.pick || {} });
    D.pack.deck = deck;
    D.pack.satisfied = deck.satisfied || [];
  };
  function reset() {
    const D = dRef.current;
    lsDel(KEY_DRAFT);
    snaps.current = [];
    D.pick = {};
    D.pack = newPack(store);
    const deck = buildDeck({ plan: D.plan || { list: [], items: [] }, store, pick: {} });
    D.pack.deck = deck;
    D.pack.satisfied = deck.satisfied || [];
    force();
  }

  /* ---- load: plan, missing-here reports, fast start ---- */
  useEffect(() => {
    let live = true;
    const D = dRef.current;
    (async () => {
      if (!D.plan) {
        let plan: Plan;
        try { plan = await get<Plan>("/api/quest/plan"); } catch { plan = { list: [], items: [] }; }
        const fl = D.fromList;
        if (fl) plan = { ...plan, list: (plan.list || []).filter(li => li.list === fl.id && li.on_list !== false) };
        D.plan = plan;
      }
      if (!live) return;
      loadCharacters();
      if (store && !D.missing) {
        D.missing = new Set();
        get<{ reports?: { item: string }[] }>(`/api/quest/stores/${encodeURIComponent(store)}/reports`)
          .then(r => { D.missing = new Set((r.reports || []).map(x => qSing(x.item))); if (live && D.missing.size) force(); })
          .catch(() => {});
      }
      // Start shopping on a list: the list is the plan; an empty list
      // falls back to the bag (quest.js qFastStart).
      if (D.fastMode && !D.fastDone) {
        D.fastDone = true;
        const raw = (D.plan.list || []).filter(li => li.on_list !== false && !li.checked).map(li => {
          const r: Line = { name: li.name, qty: li.qty || 1 };
          if (li.unit) r.unit = li.unit;
          if (li.added_by) { r.by = li.added_by; r.src = "added"; }
          return r;
        });
        if (raw.length) {
          D.raw = raw;
          try { await optimize(true); return; } catch (e) { toast(errMsg(e)); }
        }
        D.fastMode = null;
      }
      if (!live) return;
      openPack();
      setReady(true);
    })().catch(e => toast(errMsg(e)));
    return () => { live = false; clearTimeout(busyT.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The mic never outlives the screen.
  useEffect(() => () => { capture.current?.cancel(); capture.current = null; }, []);

  // renderPlan -> paintFoot -> save, on every draw.
  useEffect(() => { if (ready) save(); });
  // After a key press, focus the new card so the next arrow key works.
  useEffect(() => {
    if (!keyFocus.current) return;
    keyFocus.current = false;
    const next = document.getElementById("pack-card") || document.querySelector<HTMLElement>('[data-pack="back"]');
    try { next?.focus({ preventScroll: true }); } catch { next?.focus(); }
  });

  /* ---- decisions ---- */
  const rowOf = (card: Card, on: boolean): Pick => {
    const r: Pick = { name: card.name, qty: Math.max(1, Number(card.qty) || 1), on, src: card.src };
    if (!on) r.skipped = true;
    if (card.kind !== "added") r.extra = true;
    for (const k of ["note", "variant", "by", "aisle", "itemId"] as const) if (card[k]) r[k] = card[k];
    if (card.queued_id) r.queuedId = card.queued_id;
    if (card.from) r.from = card.from;
    if (card.kind === "added") r.src = "added";
    return r;
  };
  const applyCard = (kind: string, card: Card) => {
    const D = dRef.current;
    const had = D.pick[card.key];
    D.pick[card.key] = rowOf(card, kind === "pack");
    return had ? (JSON.parse(JSON.stringify(had)) as Pick) : null;
  };
  const decide = (kind: string, id: string) => {
    const pk = P();
    if (!pk || busy.current || (kind !== "pack" && kind !== "skip")) return false;
    const c = pk.deck[pk.deal];
    if (!c || c.id !== id) return false;
    settleLater();
    snap();
    const had = applyCard(kind, c);
    pk.decisions.push({ cardId: c.id, kind, key: c.key, had });
    pk.deal += 1;
    done(kind === "pack" ? `${c.name} packed.` : `${c.name} skipped.`, { card: c, dir: kind === "pack" ? "r" : "l" });
    return true;
  };
  const backOne = () => {
    const pk = P();
    if (!pk || busy.current || !pk.decisions.length) return false;
    snap();
    const x = pk.decisions.pop()!;
    if (x.had) dRef.current.pick[x.key] = x.had; else delete dRef.current.pick[x.key];
    pk.deal = Math.max(0, pk.deal - 1);
    done("Back one card.");
    return true;
  };
  const sweep = (kind: string) => {
    const pk = P();
    if (!pk || busy.current) return false;
    const rest = pk.deck.slice(pk.deal);
    if (!rest.length) return false;
    snap();
    for (const c of rest) {
      const had = applyCard(kind, c);
      pk.decisions.push({ cardId: c.id, kind, key: c.key, had });
    }
    pk.deal = pk.deck.length;
    done(kind === "pack" ? `All ${rest.length} ${plural(rest.length, "card", "cards")} packed.`
      : "The rest are skipped. You can find them under Skipped.");
    return true;
  };
  const restore = (key: string) => {
    const r = dRef.current.pick[key];
    if (!r || !r.skipped) return;
    snap();
    r.on = true; delete r.skipped;
    done(`${r.name} is in your bag.`);
  };
  const setCardQty = (delta: number) => {
    const pk = P();
    const c = pk && pk.deck[pk.deal];
    if (!c) return;
    c.qty = Math.min(99, Math.max(1, (c.qty || 1) + delta));
    force();
  };

  /* ---- typed items ---- */
  const dropPending = (key: string) => {
    const pk = P();
    if (!pk) return;
    const sq = squashName(key);
    for (let i = pk.deck.length - 1; i >= pk.deal; i--) if (squashName(pk.deck[i].name) === sq) pk.deck.splice(i, 1);
  };
  const addParsed = (p: { name: string; qty: number; note: string }, src: string) => {
    const D = dRef.current;
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
    const row: Pick = { name: p.name, qty: p.qty, on: true, extra: true, src, joinList: true };
    const aisle = aisleFor(p.name);
    if (aisle) row.aisle = aisle;
    if (p.note) row.note = p.note;
    const hit = exactRow(p.name, ((D.plan && D.plan.items) || []).map(i => ({ name: i.name, item_id: i.item_id })));
    if (hit && hit.item_id) row.itemId = hit.item_id;
    D.pick[key] = row;
    dropPending(key);
    return `${p.name}${p.qty > 1 ? " x" + p.qty : ""} is in your bag.`;
  };
  const addFromText = (t: string, src?: string) => {
    if (!P()) return null;
    const parsed = splitInput(t).map(parseLine).filter(p => p.name);
    if (!parsed.length) { toast("Type an item first."); return null; }
    snap();
    const msgs = parsed.map(p => addParsed(p, src || "typed"));
    done(parsed.length === 1 ? msgs[0] : `${parsed.length} items are in your bag.`);
    return { added: parsed.length };
  };
  const addStarter = (name: string) => {
    if (!P()) return;
    snap();
    done(addParsed({ name, qty: 1, note: "" }, "starter"));
  };
  const nlAdd = (value?: string) => {
    if (addFromText(value ?? textRef.current)) setText("");
  };

  /* ---- Edit sheet ---- */
  function closeEdit(quiet?: boolean, msg?: string) {
    const E = editState.current;
    if (!E) return;
    editState.current = null;
    setEditKey(null);
    if (quiet) { if (!E.dirty) snaps.current.length = Math.min(snaps.current.length, E.snapDepth - 1); }
    else if (E.dirty) done(msg || "Saved.");
    else snaps.current.length = Math.min(snaps.current.length, E.snapDepth - 1);
  }
  const openEdit = (key: string) => {
    const r = dRef.current.pick[key];
    if (!r) return;
    closeEdit(true);
    snap();
    editState.current = { key, dirty: false, snapDepth: snaps.current.length };
    setBrands([]);
    setEditKey(key);
    get<{ variants?: { name: string }[] }>("/api/pack/variants?name=" + encodeURIComponent(r.name))
      .then(out => { if (editState.current?.key === key) setBrands((out.variants || []).slice(0, 6).map(v => v.name)); })
      .catch(() => { /* offline: the custom field still works */ });
  };
  const touch = () => { if (editState.current) editState.current.dirty = true; force(); save(); };

  /* ---- photo ---- */
  const photo = async (ev: ChangeEvent<HTMLInputElement>) => {
    const input = ev.target;
    const f = input.files?.[0];
    if (!f) return;
    setStatus("Reading the photo with Spark…");
    try {
      const r = await fetch("/api/list/from-photo", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
      const out = await r.json();
      setStatus("");
      if (out.kind === "receipt") {
        toast("That looks like a receipt — file it from the List tab.");
      } else if (out.names && out.names.length) {
        const D = dRef.current;
        try {
          let plan = await get<Plan>("/api/quest/plan");
          if (D.fromList) { const id = D.fromList.id; plan = { ...plan, list: (plan.list || []).filter(li => li.list === id && li.on_list !== false) }; }
          D.plan = plan;
        } catch { /* keep the plan we have */ }
        for (const n of out.names as string[]) {
          const key = norm(n);
          D.pick[key] = { name: n, qty: (D.pick[key] || {}).qty || 1, on: true };
        }
        for (const key of Object.keys(D.pick)) dropPending(key);
        force();
        toast(out.names.length === 1 ? "Added 1 item to the quest." : `Added ${out.names.length} items to the quest.`);
      } else {
        toast("No list items found in that photo.");
      }
    } catch (e) {
      setStatus("");
      toast("Could not read that photo: " + errMsg(e));
    }
    input.value = "";
  };

  /* ---- voice ---- */
  const mic = async () => {
    if (capture.current) {
      const wav = capture.current.stop();
      capture.current = null;
      setListening(false);
      setStatus("Transcribing with Muse Voice Transcribe…");
      try {
        const t = await transcribeBlob(wav);
        setStatus(t ? "" : "That did not come through. Try again, closer to the mic.");
        if (t) {
          const cur = textRef.current;
          const merged = cur.trim() ? `${cur.trim()}, ${t}` : t;
          setText(merged);
          nlAdd(merged);
        }
      } catch (e) {
        setStatus("");
        toast("Transcription failed: " + errMsg(e));
      }
      return;
    }
    if (!voiceSupported()) {
      setStatus("Voice input is not available in this browser. The microphone on your keyboard works too.");
      return;
    }
    try {
      capture.current = await startCapture();
      setListening(true);
      setStatus("Listening…");
    } catch {
      setStatus("Microphone access was refused. You can type instead.");
    }
  };

  /* ---- plan rows: tick and remove from the Arya list ---- */
  const toggle = (key: string) => {
    const p = dRef.current.pick[key];
    if (!p) return;
    p.on = !p.on;
    force();
  };
  const removeFromList = async (key: string, itemId: string, btn: HTMLButtonElement) => {
    const D = dRef.current;
    const li = (D.plan?.list || []).find(i => norm(i.name) === key);
    if (!li || !D.plan) return;
    btn.disabled = true;
    try { await post("/api/list/remove", { item_id: itemId }); }
    catch (e) { toast(errMsg(e)); btn.disabled = false; return; }
    D.plan.list = D.plan.list.filter(i => i !== li);
    delete D.pick[key];
    force();
    toast(`${li.name} is off your list.`, { action: "Undo", onAction: async () => {
      try {
        await post("/api/list/add", { item_id: itemId });
        D.plan!.list.push(li);
        force();
      } catch (e) { toast(errMsg(e)); }
    } });
  };

  /* ---- optimize, then the next screen (qOptimizeDraft) ---- */
  async function optimize(replace: boolean) {
    const D = dRef.current;
    const out = await post("/api/quest/optimize", { items: D.raw, store: D.store });
    D.opt = out;
    D.baseItems = out.items.map((i: any) => ({ ...i }));
    D.undone = {};
    D.answers = {};
    D.qQty = {};
    for (const r of D.raw) {
      const k = norm(r.name);
      D.qQty[k] = (D.qQty[k] || 0) + r.qty;
    }
    const rep = out.report;
    const go = replace ? nav.replace : nav.show;
    if (!rep.merged.length && !rep.corrected.length && !rep.questions.length) {
      D.finalItems = D.baseItems.map(i => sessionItem(i));
      go("mode", { draft: D });
      return;
    }
    go("optimize", { draft: D });
  }
  const start = async () => {
    const D = dRef.current;
    if (D.creating) return;
    // Text still in the box becomes bag rows first.
    if (textRef.current.trim()) { addFromText(textRef.current); setText(""); textRef.current = ""; }
    const raw = pickedRows().map(r => rawItem(r));
    if (!raw.length) { toast("Add an item to start."); return; }
    D.creating = true;
    setCreating(true);
    try {
      D.raw = raw;
      // Typed and starter rows join the Arya list with their count.
      const lid = D.fromList ? { list_id: D.fromList.id } : {};
      for (const r of pickedRows()) {
        if (r.extra && r.joinList) {
          const body: Record<string, unknown> = r.itemId ? { item_id: r.itemId } : { name: r.name };
          if (r.qty > 1) body.qty = r.qty;
          if (r.by) body.by = r.by;
          if (r.approved) body.approved = true;
          post("/api/list/add", { ...body, ...lid }).catch(() => {});
        } else if (r.src === "added" && r.itemId) {
          post("/api/list/add", { item_id: r.itemId, approved: true, ...lid }).catch(() => {});
        }
      }
      await optimize(false);
    } catch (e) { toast(errMsg(e)); }
    finally { D.creating = false; setCreating(false); }
  };

  /* ---- drag, keys ---- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x0: e.clientX, dx: 0 };
    e.currentTarget.classList.add("drag");
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    g.dx = e.clientX - g.x0;
    e.currentTarget.style.transform = !reduced() ? `translateX(${g.dx}px) rotate(${g.dx / 20}deg)` : `translateX(${g.dx}px)`;
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    const el = e.currentTarget;
    el.classList.remove("drag");
    const dec = dragDecision(g.dx, el.getBoundingClientRect().width);
    if (dec) decide(dec, el.dataset.card || "");
    else el.style.transform = "";
  };
  const onDeckKey = (ev: React.KeyboardEvent) => {
    const pk = P();
    if (!pk) return;
    const tag = String((ev.target as HTMLElement).tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    const card = pk.deck[pk.deal];
    if (!card) return;
    const kind = ev.key === "ArrowRight" ? "pack" : ev.key === "ArrowLeft" ? "skip" : null;
    if (!kind) return;
    ev.preventDefault();
    keyFocus.current = true;
    decide(kind, card.id);
  };

  /* ================= render ================= */
  const pk = P();
  const plan: Plan = d.plan || { list: [], items: [] };
  const pick = d.pick;

  // renderPlan: list rows become picks; unanswered cards and skipped rows are drawn by the deck.
  const holds = (key: string) => {
    const r = pick[key];
    return !!(pk && pk.deck.slice(pk.deal).some(c => c.key === key)) || !!(r && r.skipped);
  };
  type Info = { key: string; li: ListRow; b: ReturnType<typeof planBucket> };
  const groups: { here: Info[]; new: Info[]; elsewhere: Record<string, Info[]> } = { here: [], new: [], elsewhere: {} };
  if (ready) {
    for (const li of plan.list || []) {
      const b = planBucket(plan, li, store);
      const key = norm(li.name);
      if (holds(key)) continue;
      if (!(key in pick)) {
        pick[key] = { name: li.name, qty: li.qty || 1, on: b.bucket !== "elsewhere" };
        if (li.unit) pick[key].unit = li.unit;
        if (li.added_by) { pick[key].src = "added"; pick[key].by = li.added_by; }
        else pick[key].src = li.source === "pattern" ? "due" : "list";
      }
      const info = { key, li, b };
      if (b.bucket === "elsewhere") (groups.elsewhere[b.store] = groups.elsewhere[b.store] || []).push(info);
      else groups[b.bucket].push(info);
    }
  }

  const srcChip = (r: Pick) => {
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
  };
  const missingNote = (name: string, note: string) => {
    if (!d.missing || !d.missing.has(qSing(name))) return note;
    return (note ? note + " · " : "") + "reported missing here";
  };
  const bagRow = (key: string, row: Pick, o?: { name?: string; note?: string; itemId?: string }) => {
    const on = !!row.on;
    const name = o?.name || row.name;
    const sub = [row.note, row.variant].filter(Boolean).join(" · ");
    const aisle = row.aisle || aisleFor(name);
    const chip = srcChip(row);
    const chips = [chip, aisle].filter(Boolean);
    return (
      <div className={"planrow packrow" + (on ? " in" : "")} key={key}>
        <button className="plantick" data-plan={key} aria-pressed={on} type="button" onClick={() => toggle(key)}>
          <span className="planbox" aria-hidden="true">{on ? "✓" : ""}</span>
          <span className="grow"><span className="name">{name}</span>{row.qty > 1 ? <span className="packx">x{row.qty}</span> : null}
            {sub ? <span className="sub packnote">{sub}</span> : null}
            {o?.note ? <span className="sub">{o.note}</span> : null}
            {chips.length ? <span className="packchips">{chips.map((c, i) =>
              <span key={i} className={"packchip" + (i === 0 && chip ? " src" : "")}>{c}</span>)}</span> : null}</span>
        </button>
        <button className="packedit" data-packedit={key} aria-label={`Edit ${name}`} type="button" onClick={() => openEdit(key)}>Edit</button>
        {o?.itemId ? <button className="planrm" data-planrm={key} data-item={o.itemId} aria-label={`Remove ${name} from your list`} type="button"
          onClick={ev => removeFromList(key, o.itemId!, ev.currentTarget)}>✕</button> : null}
      </div>
    );
  };
  const listRow = (r: Info, note: string) => bagRow(r.key, pick[r.key], { name: r.li.name, note: missingNote(r.li.name, note), itemId: r.li.item_id });
  const sect = (title: string, rows: ReactNode[]) => rows.length
    ? <div key={title}><h3 className="sect">{title}</h3><div className="group">{rows}</div></div> : null;

  const rows = allRows();
  const extras = rows.filter(r => r.extra && !r.skipped);
  const car = extras.filter(r => r.src === "carried");
  const que = extras.filter(r => r.src === "queued");
  const froms = [...new Set(que.map(r => r.from).filter(Boolean))];
  const qTitle = froms.length === 1 ? `From @${froms[0]}'s haul` : "From a friend's haul";
  const mine = extras.filter(r => r.src !== "carried" && r.src !== "queued");
  const skipped = rows.filter(r => r.skipped);

  const sections: ReactNode[] = ready ? [
    sect(`Left from last trip · ${car.length}`, car.map(r => bagRow(r.key, r))),
    sect(`${qTitle} · ${que.length}`, que.map(r => bagRow(r.key, r))),
    sect(`Usually bought here · ${groups.here.length}`, groups.here.map(r => listRow(r, `${r.b.here} of ${r.b.total} times here`))),
    sect(`New on your list · ${groups.new.length}`, groups.new.map(r => listRow(r, "No history yet"))),
    ...Object.entries(groups.elsewhere).map(([st, rs]) =>
      sect(`Usually from ${st} · ${rs.length}`, rs.map(r => listRow(r, `${st} ${r.b.n} of ${r.b.total} times · stays on your list if unticked`)))),
    sect(`Added for this trip · ${mine.length}`, mine.map(r => bagRow(r.key, r))),
    skipped.length && pk ? (
      <div key="skipped"><h3 className="sect">Skipped · {skipped.length}</h3>
        <div className="group packskipped">
          <button className="packlink packfold" data-packfold="skipped" aria-expanded={!!pk.expanded.skipped} type="button"
            onClick={() => { pk.expanded.skipped = !pk.expanded.skipped; force(); save(); }}>
            {pk.expanded.skipped ? "Hide skipped items" : `Show ${skipped.length} skipped ${plural(skipped.length, "item", "items")}`}</button>
          {pk.expanded.skipped ? skipped.map(r => (
            <div className="planrow packrow" key={r.key}><span className="grow packskipname"><span className="name">{r.name}</span>{r.qty > 1 ? <span className="packx">x{r.qty}</span> : null}</span>
              <button className="packback" data-packrestore={r.key} aria-label={`Pack ${r.name}`} type="button" onClick={() => restore(r.key)}>+ Pack</button></div>
          )) : null}
        </div>
      </div>
    ) : null,
  ].filter(Boolean) : [];
  const planBody = !ready ? null : sections.length ? sections
    : <div className="group"><p className="empty">{plan.has_history
      ? "Your bag is empty. Add something above or bring back a skipped item."
      : "Your bag is empty. Type what you need above."}</p></div>;

  // The deck: the card, or the first-run start, or a short note.
  let deck: ReactNode = null;
  if (ready && pk) {
    const n = pk.deck.length;
    const c = pk.deck[pk.deal];
    if (c) {
      const left = n - pk.deal;
      deck = (
        <>
          <div className="packhead"><span className="packcount" aria-live="polite">Card {pk.deal + 1} of {n}</span></div>
          <div className="packlinks">
            {pk.decisions.length ? <button className="packlink" data-pack="back" type="button" onClick={backOne}>Back one card</button> : <span></span>}
            <span className="packlinkgroup"><button className="packlink" data-pack="all" type="button" onClick={() => sweep("pack")}>Pack all {left}</button>
              <button className="packlink" data-pack="rest" type="button" onClick={() => sweep("skip")}>Skip the rest</button></span></div>
          <div className="packdeck">
            <div className="packcard" id="pack-card" data-card={c.id} tabIndex={0} role="group" key={c.id}
              aria-label={`${c.name}. Card ${pk.deal + 1} of ${n}. Press the right arrow to pack it. Press the left arrow to skip it.`}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <span className="packchip src">{c.chip}</span>
              <img className="packart" src={asset(`assets/characters/${faceFor(c.name)}`)} alt="" />
              <h3>{c.name}</h3>
              <p className="packwhy">{reasonFor(c)}</p>
              <span className="packqty" role="group" aria-label="Quantity"><button type="button" data-packq="-1" aria-label="One less" onClick={() => setCardQty(-1)}>−</button><b aria-live="polite">{c.qty || 1}</b><button type="button" data-packq="1" aria-label="One more" onClick={() => setCardQty(1)}>+</button></span>
            </div>
            {leave && (
              <div className={"packcard leaving" + (leave.go ? (leave.dir === "r" ? " out-r" : " out-l") : "")} aria-hidden="true">
                <span className="packchip src">{leave.card.chip}</span>
                <img className="packart" src={asset(`assets/characters/${faceFor(leave.card.name)}`)} alt="" />
                <h3>{leave.card.name}</h3>
                <p className="packwhy">{reasonFor(leave.card)}</p>
                <span className="packqty"><button type="button" tabIndex={-1}>−</button><b>{leave.card.qty || 1}</b><button type="button" tabIndex={-1}>+</button></span>
              </div>
            )}
          </div>
          <div className="packbtns"><button className="packbtn skip" data-pack="skip" type="button" onClick={() => decide("skip", c.id)}>Skip</button>
            <button className="packbtn pack" data-pack="pack" type="button" onClick={() => decide("pack", c.id)}>Pack it</button></div>
        </>
      );
    } else if (n && pk.decisions.length) {
      deck = (
        <>
          <div className="packhead"><span className="packcount">That was the last card. Your bag is below.</span></div>
          <div className="packlinks"><button className="packlink" data-pack="back" type="button" onClick={backOne}>Back one card</button><span></span></div>
        </>
      );
    } else if (!plan.has_history) {
      const have = new Set(allRows().filter(r => r.on).map(r => squashName(r.name)));
      const chips = STARTERS.filter(s => !have.has(squashName(s)));
      deck = (
        <div className="packfirst"><h3>Start your list</h3>
          <p className="muted">No receipts yet. Type what you need above. After your first receipt, Arya deals cards for you.</p>
          {chips.length ? <p className="packchips" aria-label="Common starters">{chips.map(s =>
            <button key={s} className="chip packstarter" data-packstarter={s} type="button" onClick={() => addStarter(s)}>+ {s}</button>)}</p> : null}
          <button className="packlink" data-packscan="1" type="button" onClick={() => nav.show("list")}>Scan an old receipt</button></div>
      );
    }
  }

  // The foot: estimate and budget.
  const est = ready && pk ? estimate(pickedRows(), plan, store) : null;
  const estLine = est ? estimateLine(est) : "";
  const foot = pk && est && estLine ? (
    <>
      <p className="packestimate" id="nl-estimate">{estLine}</p>
      <div className="budgetrow"><label htmlFor="nl-budget">Budget for this trip (optional)</label>
        <input type="text" id="nl-budget" inputMode="decimal" autoComplete="off" placeholder="$" value={pk.budget}
          onChange={e => {
            pk.budget = e.target.value.replace(/[^0-9.]/g, "").slice(0, 7);
            if (pk.budget) lsSet(KEY_BUDGET, pk.budget); else lsDel(KEY_BUDGET);
            force();
          }} /></div>
      <p className="budgetline" id="nl-budgetline" role="status">{budgetLine(est.total, pk.budget)}</p>
    </>
  ) : null;

  // The Start button counts the bag and any text not added yet.
  const count = ready && pk ? pickedRows().length + splitInput(text).length : 0;
  const startLabel = !ready || !pk ? "Start the quest →" : count ? `Start the quest · ${count} ${plural(count, "item", "items")} →` : "Add an item to start";

  const ed = editKey ? dRef.current.pick[editKey] : null;
  const showAisle = !!ed && !!ed.extra && (ed.src === "typed" || ed.src === "starter");
  const brandChip = (label: string, value: string) => (
    <button type="button" className="chip" data-edit="brand" data-brand={value} key={label + value}
      aria-pressed={(ed?.variant || "") === value}
      onClick={() => { if (!ed) return; ed.variant = value; if (variantRef.current) variantRef.current.value = value; touch(); }}>{label}</button>
  );

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("store"); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }} id="nl-title">{store ? `Your quest at ${store}` : "Your quest"}</h2>
      <p className="muted" id="nl-sub">{NOTE}</p>
      <div id="nl-deck" hidden={!deck} onKeyDown={onDeckKey}>{deck}</div>
      <div className="group pad packcomposer">
        <label className="field" htmlFor="nl-text">Add something else</label>
        <textarea id="nl-text" rows={2} placeholder={"oat milk\n2x tortillas"} aria-label="Add something else" value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); nlAdd(); } }} />
        <p className="packaddrow">
          <button className={"btn grow" + (listening ? " listening" : "")} id="nl-mic" type="button" onClick={mic}>{listening ? "Stop & transcribe" : "Record"}</button>
          <label className="btn grow" htmlFor="nl-photo" style={{ textAlign: "center" }}>Photo</label>
          <button className="btn grow" id="nl-add" type="button" onClick={() => nlAdd()}>Add</button>
          <input type="file" id="nl-photo" accept="image/*" hidden onChange={photo} />
        </p>
        <p className="muted nomargin" id="nl-status">{status}</p>
        <div id="nl-helper"></div>
      </div>
      <div id="nl-plan">{planBody}</div>
      <div id="nl-foot">{foot}</div>
      <p><button id="nl-next" className="btn primary wide" type="button" aria-disabled={ready && pk ? count === 0 : undefined}
        disabled={creating} onClick={start}>{startLabel}</button></p>

      <Sheet open={!!ed} onClose={() => closeEdit()} id="pack-sheet" className="packsheetwrap">
        {ed && editKey && (
          <div className="packsheet" role="group" aria-labelledby="pack-edit-title" key={editKey}>
            <h3 id="pack-edit-title">{ed.name}</h3>
            <div className="packfield"><span className="packlabel" id="pack-q-label">Quantity</span>
              <span className="packqty" role="group" aria-labelledby="pack-q-label">
                <button type="button" data-edit="qty-" aria-label="One less" onClick={() => { ed.qty = Math.min(99, Math.max(1, (ed.qty || 1) - 1)); touch(); }}>−</button>
                <b id="pack-edit-qty" aria-live="polite">{ed.qty || 1}</b>
                <button type="button" data-edit="qty+" aria-label="One more" onClick={() => { ed.qty = Math.min(99, Math.max(1, (ed.qty || 1) + 1)); touch(); }}>+</button></span></div>
            <label className="packfield" htmlFor="pack-edit-note"><span className="packlabel">Note</span>
              <input type="text" id="pack-edit-note" ref={noteRef} maxLength={60} autoComplete="off" placeholder="Size, ripeness, a reminder" defaultValue={ed.note || ""}
                onChange={e => { ed.note = clip(e.target.value, 60); touch(); }} /></label>
            <div className="packfield"><span className="packlabel">Brand</span>
              <span className="packchips" id="pack-edit-brands">{brandChip("Any brand", "")}{brands.map(b => brandChip(b, b))}</span>
              <input type="text" id="pack-edit-variant" ref={variantRef} maxLength={60} autoComplete="off" placeholder="Other brand" aria-label="Other brand" defaultValue={ed.variant || ""}
                onChange={e => { ed.variant = clip(e.target.value, 60); touch(); }} /></div>
            {showAisle ? <div className="packfield"><span className="packlabel">Aisle</span><span className="packchips">{AISLES.map(a =>
              <button type="button" className="chip" data-edit="aisle" data-aisle={a} key={a} aria-pressed={ed.aisle === a}
                onClick={() => { ed.aisle = ed.aisle === a ? "" : a; touch(); }}>{a}</button>)}</span></div> : null}
            <div className="packsheetbtns"><button type="button" className="packlink" data-edit="remove" onClick={() => {
              const name = ed.name, key = editKey;
              if (ed.extra) delete dRef.current.pick[key]; else ed.on = false;
              if (editState.current) editState.current.dirty = true;
              closeEdit(false, `${name} is out of this trip.`);
            }}>Take out of this trip</button>
              <button type="button" className="packbtn pack" data-edit="done" data-first onClick={() => closeEdit()}>Done</button></div>
          </div>
        )}
      </Sheet>
    </>
  );
}
