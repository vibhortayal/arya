/* The hunt menu's logic (pwa/huntmenu.js, minus its sheet): pure
 * mirrors of api/hunt.py so a change made offline lands the same way
 * on the phone as on the server later, and the online-first change
 * runner that falls back to the outbox. */
import { post } from "../../lib/api";
import { Q, qCheck, qFlushOutbox, qOutbox, qOutboxSave, qParseLines, type Item, type LeftEntry, type Session } from "./model";

export const NAME_MAX = 80, NOTE_MAX = 60, QTY_MIN = 1, QTY_MAX = 99;
const ITEMS_MAX = 200;
const HOWS = ["saved", "dropped"];
export const nrm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keyOf = (name: string) => "name:" + nrm(name);
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
function fail(msg: string, code = 400) { const e = new Error(msg) as Error & { code: number }; e.code = code; return e; }

export function cleanName(raw: unknown): string {
  const name = String(raw == null ? "" : raw).split(/\s+/).filter(Boolean).join(" ");
  if (!name) throw fail("name is required");
  if (name.length > NAME_MAX) throw fail(`name is too long (max ${NAME_MAX})`);
  return name;
}
function cleanQty(raw: unknown): number {
  let n = raw;
  if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) n = Number(raw);
  if (typeof n !== "number" || !Number.isInteger(n)) throw fail("qty must be a whole number");
  if (n < QTY_MIN || n > QTY_MAX) throw fail(`qty must be ${QTY_MIN} to ${QTY_MAX}`);
  return n;
}
function cleanNote(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw !== "string") throw fail("note must be text");
  const note = raw.trim();
  if (note.length > NOTE_MAX) throw fail(`note is too long (max ${NOTE_MAX})`);
  return note;
}
export function findIn(list: Item[], name: string): number {
  const n = nrm(name);
  for (let i = 0; i < list.length; i++) if (nrm(list[i].name) === n) return i;
  const key = keyOf(name);
  for (let i = 0; i < list.length; i++) if (list[i].group === key) return i;
  return -1;
}
function lists(sess: Session): [Item[], LeftEntry[]] {
  if (!Array.isArray(sess.items)) sess.items = [];
  if (!Array.isArray(sess.left)) sess.left = [];
  return [sess.items, sess.left];
}
function itemFromLeft(entry: LeftEntry): Item {
  const item: Record<string, unknown> = {};
  for (const k of Object.keys(entry)) if (!["how", "idx", "at", "swapped_for"].includes(k)) item[k] = (entry as Record<string, unknown>)[k];
  item.checked = false;
  return item as Item;
}
const nowIso = () => new Date().toISOString().slice(0, 19);

export type LeaveIn = { item: string; how: string };
export type Moved = LeftEntry & { how: string; idx: number };

export function applyLeave(sess: Session, entries: LeaveIn[], now?: string): Moved[] {
  if (!Array.isArray(entries) || !entries.length) throw fail("entries is required");
  if (entries.length > ITEMS_MAX) throw fail("too many entries");
  const [items, left] = lists(sess);
  const plan: [number, string][] = [], seen = new Set<number>();
  for (const e of entries) {
    if (!e || typeof e !== "object") throw fail("each entry needs an item and how");
    const how = e.how === undefined ? "saved" : e.how;
    if (!HOWS.includes(how)) throw fail(`how must be one of ${HOWS.join(", ")}`);
    const name = cleanName(e.item);
    const i = findIn(items, name);
    if (i < 0) {
      if (findIn(left, name) >= 0) continue;
      throw fail(`no such item: ${name}`, 404);
    }
    if (items[i].checked) throw fail(`${items[i].name} is in your cart. Put it back first.`);
    if (!seen.has(i)) { seen.add(i); plan.push([i, how]); }
  }
  const at = now || nowIso();
  const moved = plan.map(([i, how]) => {
    const entry: Record<string, unknown> = {};
    for (const k of Object.keys(items[i])) if (k !== "checked") entry[k] = (items[i] as Record<string, unknown>)[k];
    return Object.assign(entry, { how, idx: i, at }) as Moved;
  });
  sess.items = items.filter((_, j) => !seen.has(j));
  left.push(...moved);
  return moved;
}
export function applyRestore(sess: Session, name: string): Item {
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
  const pos = Number.isInteger(entry.idx) ? Math.max(0, Math.min(entry.idx!, items.length)) : items.length;
  items.splice(pos, 0, item);
  return item;
}
export function applyEdit(sess: Session, name: string, qty?: number | null, note?: string | null): Item {
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
export type ForgotRes = { result: string; reopened: boolean; prevQty: number | null; how?: string; item: Item };
export function applyForgot(sess: Session, rawName: string, qty?: number | null, rawNote?: string): ForgotRes {
  const name = cleanName(rawName);
  const n = cleanQty(qty == null ? 1 : qty);
  const note = cleanNote(rawNote);
  const [items, left] = lists(sess);
  const k = findIn(left, name);
  if (k >= 0) {
    const how = left[k].how;
    const item = applyRestore(sess, name);
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
  const item: Item = { name, qty: n, checked: false, group: keyOf(name), added_mid_hunt: true };
  if (note) item.note = note;
  items.push(item);
  return { result: "added", reopened: false, prevQty: null, item };
}

/* Substitutes from the household's own receipt history. Never invented. */
const STOP = new Set(["the", "and", "for", "with", "gal", "oz", "lb", "lbs", "pack", "pk", "ct", "fresh", "organic", "large", "small", "each"]);
const tokens = (name: string) => nrm(name).split(" ").filter(t => t.length > 2 && !/^\d/.test(t) && !STOP.has(t));
function sameStore(a: string, b: string) {
  const x = nrm(a), y = nrm(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
}
export function huntSubstitutes(sess: Session, planItems: { name: string; stores?: Record<string, number> }[], name: string, store: string, max = 3) {
  const want = new Set(tokens(name));
  const onHunt = new Set([...(sess.items || []), ...(sess.left || [])].map(i => nrm(i.name)));
  onHunt.add(nrm(name));
  const seen = new Set<string>(), out: { name: string; here: number; total: number }[] = [];
  for (const p of planItems || []) {
    const n = nrm(p.name);
    if (!n || onHunt.has(n) || seen.has(n)) continue;
    if (!tokens(p.name).some(t => want.has(t))) continue;
    seen.add(n);
    let here = 0, total = 0;
    for (const [s, c] of Object.entries(p.stores || {})) { total += c; if (sameStore(s, store)) here += c; }
    out.push({ name: p.name, here, total });
  }
  out.sort((a, b) => (b.here - a.here) || (b.total - a.total) || a.name.localeCompare(b.name));
  return out.slice(0, max);
}

/* ---- Changes: online first, the outbox when the signal is gone ---- */
type Toast = (msg: string, opts?: { action?: string; onAction?: () => void }) => void;
export const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function afterMutation(sess: Session) {
  Q.focusIdx = -1;
  if (Q.current === sess) Q.repaint?.();
}

export async function mutate<R>(toast: Toast, sess: Session, op: string, body: Record<string, unknown>, mirror: (s: Session) => R):
  Promise<{ ok: false } | { ok: true; queued: boolean; res: R; server?: any }> {
  let res: R;
  try { res = mirror(clone(sess)); }
  catch (e) { toast((e as Error).message); return { ok: false }; }
  if (qOutbox().length && !offline()) await qFlushOutbox();
  try {
    if (offline()) throw new TypeError("No connection");
    const s = await post<Session>(`/api/quest/sessions/${sess.id}/${op}`, body);
    const server = s && s.forgot;
    delete s.forgot;
    Object.assign(sess, s);
    delete sess.new_sticker;
    return { ok: true, queued: false, res, server };
  } catch (e) {
    if (!(e instanceof TypeError)) { toast((e as Error).message); return { ok: false }; }
    try { mirror(sess); } catch (err) { toast((err as Error).message); return { ok: false }; }
    qOutboxSave([...qOutbox(), { sid: sess.id, op, body }]);
    Q.repaint?.();
    return { ok: true, queued: true, res };
  }
}
/* Changes that need the server (a swap, a report taken back). */
export async function online(toast: Toast, sess: Session, op: string, body: Record<string, unknown>): Promise<Session | null> {
  if (offline()) { toast("No signal. This needs a connection."); return null; }
  try {
    const s = await post<Session>(`/api/quest/sessions/${sess.id}/${op}`, body);
    Object.assign(sess, s);
    delete sess.new_sticker;
    return s;
  } catch (e) {
    toast(e instanceof TypeError ? "No signal. This needs a connection." : (e as Error).message);
    return null;
  }
}
const leaveBody = (entries: LeaveIn[]) => ({ entries: entries.map(e => ({ item: e.item, how: e.how })) });

export async function leaveItems(toast: Toast, sess: Session, entries: LeaveIn[]): Promise<Moved[] | null> {
  const r = await mutate(toast, sess, "leave", leaveBody(entries), s => applyLeave(s, entries));
  if (!r.ok) return null;
  afterMutation(sess);
  return r.res;
}
export async function restoreItems(toast: Toast, sess: Session, moved: Moved[]) {
  for (const m of moved.slice().sort((a, b) => a.idx - b.idx)) {
    await mutate(toast, sess, "restore", { item: m.name }, s => applyRestore(s, m.name));
  }
  afterMutation(sess);
}

/* ---- Forgot something ---- */
const forgotMsg = (r: ForgotRes, typed: string) => {
  const name = (r.item && r.item.name) || typed;
  if (r.result === "merged") return `${name} already on the list, now x${r.item.qty}.`;
  if (r.result === "restored") return `${name} is back on the list.`;
  return `${name} added.`;
};
async function forgotOne(toast: Toast, sess: Session, name: string, qty: number, note: string) {
  const body = { name, qty, note: note || "" };
  const r = await mutate(toast, sess, "forgot", body, s => applyForgot(s, name, qty, note));
  if (!r.ok) return null;
  let res = r.res;
  if (!r.queued && r.server && r.server.item) {
    res = { result: r.server.result, reopened: !!r.server.reopened, prevQty: r.server.prev_qty, how: r.server.how, item: r.server.item };
  }
  const typed = cleanName(name);
  const undo = async () => {
    if (res.result === "added") {
      if (qOutbox().length && !offline()) await qFlushOutbox();
      const out = qOutbox();
      const k = out.findIndex(e => e.op === "forgot" && e.sid === sess.id && nrm(e.body && e.body.name) === nrm(typed));
      if (k >= 0) {
        qOutboxSave(out.filter((_, n) => n !== k));
        const at = findIn(sess.items, typed);
        if (at >= 0) sess.items.splice(at, 1);
        Q.repaint?.();
      } else if (!(await online(toast, sess, "remove-added", { item: res.item.name }))) return;
    } else if (res.result === "merged") {
      const back = { item: res.item.name, qty: res.prevQty };
      await mutate(toast, sess, "edit", back, s => applyEdit(s, back.item, back.qty));
      if (res.reopened) { try { await qCheck(sess, res.item.name, true); } catch (e) { toast((e as Error).message); } }
    } else if (res.result === "restored") {
      const entries = [{ item: res.item.name, how: res.how || "saved" }];
      await mutate(toast, sess, "leave", { entries }, s => applyLeave(s, entries));
    }
    afterMutation(sess);
  };
  return { msg: forgotMsg(res, typed), undo };
}
export async function submitForgot(toast: Toast, sess: Session | null, text: string) {
  if (!sess || !String(text || "").trim()) return;
  const done: { msg: string; undo: () => Promise<void> }[] = [];
  for (const ln of qParseLines(text)) {
    let qty = ln.qty;
    if (!(qty >= QTY_MIN && qty <= QTY_MAX)) qty = 1;
    const one = await forgotOne(toast, sess, ln.name, qty, "");
    if (one) done.push(one);
  }
  if (!done.length) return;
  afterMutation(sess);
  const msg = done.length === 1 ? done[0].msg : `${done.length} items added.`;
  toast(msg, { action: "Undo", onAction: async () => { for (const d of done.slice().reverse()) await d.undo(); } });
}

/* The left fold's Bring back. */
export async function bringBack(toast: Toast, sess: Session, k: number) {
  const e = (sess.left || [])[k];
  if (!e) return;
  const name = e.name, how = e.how || "saved";
  const r = await mutate(toast, sess, "restore", { item: name }, s => applyRestore(s, name));
  if (!r.ok) return;
  afterMutation(sess);
  toast(`${name} is back on the list.`, { action: "Undo", onAction: async () => {
    const entries = [{ item: name, how }];
    await mutate(toast, sess, "leave", { entries }, s => applyLeave(s, entries));
    afterMutation(sess);
  } });
}
