/* List changes made with no signal (owner, 2026-11-01: "i want offline
 * add to queue"). Reverses #323 for lists only: receipts, Ask, voice,
 * photo adds and whole-list changes (new, rename, delete) stay online.
 *
 * post() (lib/api.ts) hands a list write here when the phone is offline,
 * when the send fails for want of a connection, or while older changes
 * are still waiting (so changes go out in the order they were made).
 * The change is kept in localStorage under the signed-in account and
 * answered at once with {queued: true}. Reads of /api/home come back
 * with the waiting changes already applied (applyQueued), so the screen
 * shows what the person did.
 *
 * flush() sends the waiting changes in order when the phone is back
 * online, when the app opens, and after each new queued change while
 * online. Each carries its op id (X-Arya-Op) and when it was made
 * (X-Arya-Op-At, X-Arya-Op-Sent): the server applies an id once, and
 * skips a change older than the item's last change (api/listops.py).
 * An item added offline has a "local:" id until its add is sent; later
 * changes to it are rewritten to the real id. The demo keeps nothing,
 * so it never queues. Signing out keeps an account's waiting changes:
 * they go out the next time that account signs in on this phone. */
import { account, savedRead } from "./offline";

export type QOp = { id: string; path: string; body: Record<string, unknown>; at: number; tries?: number };
export type Synced = { done: number; skipped: number; failed: number; skipped_names: string[]; failed_names: string[] };

const PREFIX = "arya.listq:";
export const CHANGE = "arya-listq-change";
export const SYNCED = "arya-listq-synced";
const ITEM = /^\/api\/list\/(add|remove|qty|edit|check|check-ok|move|also|aisle)$/;
const FLAG = /^\/api\/items\/[^/]+\/flag$/;
const TEXT = "/api/list/from-text";
const MAX_OPS = 300;
const LOCAL = "local:";

export const queueable = (path: string) => ITEM.test(path) || FLAG.test(path) || path === TEXT;
export const isLocalId = (id: unknown) => typeof id === "string" && id.startsWith(LOCAL);
const key = () => { const u = account(); return u ? PREFIX + u : null; };
export const canQueue = () => key() !== null;

export function newOpId(): string {
  try { if (typeof crypto?.randomUUID === "function") return crypto.randomUUID(); } catch { /* insecure page */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export function queued(): QOp[] {
  const k = key();
  if (!k) return [];
  try { const v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function save(ops: QOp[]) {
  const k = key();
  if (!k) return;
  try { ops.length ? localStorage.setItem(k, JSON.stringify(ops)) : localStorage.removeItem(k); }
  catch { /* storage full: the change still shows until reload */ }
  try { dispatchEvent(new Event(CHANGE)); } catch { /* no window */ }
}
export const pendingCount = () => queued().length;

/* The pieces a typed add will become: the server's split is the real
 * one (lines, semicolons, commas); this only draws the rows meanwhile. */
export const pieces = (text: string) => {
  const seen = new Set<string>();
  return String(text || "").split(/[\n;,]+/).map(s => s.replace(/^[\s\-*•\d.)\]]+/, "").trim())
    .filter(s => s && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true)).slice(0, 50);
};
const localIds = (op: QOp) => pieces(String(op.body.text || "")).map((_, k) => `${LOCAL}${op.id}:${k}`);

/* Keep a change and answer as the server would have, enough for the
 * screens: {ok, queued} for item writes, an add result for typed adds. */
export function enqueue(path: string, body: Record<string, unknown>, id = newOpId()): Record<string, unknown> {
  const op: QOp = { id, path, body: body || {}, at: Date.now() };
  const ops = queued();
  if (!ops.some(o => o.id === id)) save([...ops, op].slice(-MAX_OPS));
  if (path === TEXT) {
    const names = pieces(String(op.body.text || ""));
    const ids = localIds(op);
    return { queued: true, added: names.length, already: 0, already_names: [], back: [], moved: [], also: [],
      names, source: "queued", skipped: [], item_ids: ids, all_item_ids: ids };
  }
  return { ok: true, queued: true, item_id: op.body.item_id ?? null };
}

type Row = Record<string, any>;
/* /api/home with the waiting changes applied, in order. */
export function applyQueued<T>(home: T): T {
  const ops = queued();
  const h = home as unknown as { list?: { items?: Row[] } };
  if (!ops.length || !h || !h.list || !Array.isArray(h.list.items)) return home;
  let items: Row[] = h.list.items.map(i => ({ ...i }));
  const find = (id: unknown) => items.find(i => i.item_id === id);
  for (const op of ops) {
    const b = op.body as Row;
    const m = op.path.match(ITEM);
    const verb = m ? m[1] : op.path === TEXT ? "text" : "flag";
    if (verb === "text") {
      const ids = localIds(op);
      pieces(String(b.text || "")).forEach((name, k) => {
        const same = items.find(i => i.on_list && String(i.name).toLowerCase() === name.toLowerCase());
        if (same) { same.checked = false; if (b.list_id) same.list = b.list_id; return; }
        items.push({ item_id: ids[k], name, qty: 1, on_list: true, checked: false, list: b.list_id || null, source: "queued" });
      });
      continue;
    }
    const flagId = verb === "flag" ? decodeURIComponent(op.path.split("/")[3]) : null;
    const it = find(flagId ?? b.item_id);
    if (!it) continue;
    const lid = b.list_id as string | undefined;
    const extra = lid && it.list !== lid && (it.also || []).includes(lid);
    switch (verb) {
      case "check":
        if (extra) it.checked_in = b.checked ? [...new Set([...(it.checked_in || []), lid])] : (it.checked_in || []).filter((x: string) => x !== lid);
        else it.checked = !!b.checked;
        break;
      case "edit": for (const f of ["name", "qty", "unit", "note"]) if (f in b) it[f] = b[f]; break;
      case "qty": it.qty = b.qty; if ("unit" in b) it.unit = b.unit; break;
      case "remove":
        if (extra) it.also = (it.also || []).filter((x: string) => x !== lid);
        else if (isLocalId(it.item_id)) items = items.filter(i => i !== it);
        else { it.on_list = false; it.checked = false; }
        break;
      case "add": it.on_list = true; it.checked = false; if (lid) it.list = lid; break;
      case "move": it.list = b.list_id ?? null; break;
      case "also":
        it.also = b.on === false ? (it.also || []).filter((x: string) => x !== lid) : [...new Set([...(it.also || []), lid])];
        break;
      case "aisle": it.aisle = b.aisle; break;
      case "flag":
        if (b.never) items = items.filter(i => i !== it);
        else if (b.manual === false) it.on_list = false;
        break;
    }
  }
  return { ...(home as object), list: { ...h.list, items } } as T;
}

export type Send = (path: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
let running: Promise<Synced> | null = null;

/* Send the waiting changes in order. A change the server refuses (4xx)
 * is dropped and counted as failed; a lost connection stops the run and
 * keeps the rest for next time. */
export function flush(send: Send): Promise<Synced> {
  if (running) return running;
  const run = (async () => {
    const out: Synced = { done: 0, skipped: 0, failed: 0, skipped_names: [], failed_names: [] };
    const ids = new Map<string, string>();      // local id -> real id
    const dropped = new Set<string>();          // local ids whose add failed
    const saved = (savedRead<{ list?: { items?: Row[] } }>("/api/home")?.data?.list?.items) || [];
    const nameOf = (op: QOp) => {
      const id = FLAG.test(op.path) ? decodeURIComponent(op.path.split("/")[3]) : op.body.item_id;
      return String(op.body.name || op.body.text || saved.find(i => i.item_id === id)?.name || "");
    };
    try {
      for (let ops = queued(); ops.length; ops = queued()) {
        const op = ops[0];
        let body = { ...op.body };
        let path = op.path;
        const target = FLAG.test(path) ? decodeURIComponent(path.split("/")[3]) : body.item_id;
        if (isLocalId(target)) {
          const real = ids.get(target as string);
          if (!real) {
            // Its add failed (or ran in another tab): nothing to change.
            if (dropped.has(target as string) || !ops.some(o => o.path === TEXT && localIds(o).includes(target as string))) {
              save(queued().filter(o => o.id !== op.id));
              continue;
            }
          } else if (FLAG.test(path)) path = `/api/items/${encodeURIComponent(real)}/flag`;
          else body = { ...body, item_id: real };
        }
        let r: Row;
        try {
          r = await send(path, body, { "X-Arya-Op": op.id, "X-Arya-Op-At": String(op.at), "X-Arya-Op-Sent": String(Date.now()) }) as Row;
        } catch (e) {
          if (e instanceof TypeError) break;
          const status = (e as { status?: number }).status || 0;
          // Signed out on the server: keep everything for the next sign-in.
          if (status === 401) break;
          const tries = (op.tries || 0) + 1;
          if (status >= 500 && tries < 3) {
            save(queued().map(o => (o.id === op.id ? { ...o, tries } : o)));
            break;
          }
          out.failed++; out.failed_names.push(nameOf(op));
          if (op.path === TEXT) localIds(op).forEach(i => dropped.add(i));
          save(queued().filter(o => o.id !== op.id));
          continue;
        }
        if (op.path === TEXT && r && Array.isArray(r.all_item_ids)) {
          // The server's split can differ from ours; match in order.
          localIds(op).forEach((l, k) => { if (r.all_item_ids[k]) ids.set(l, r.all_item_ids[k]); else dropped.add(l); });
        }
        if (r && r.stale) { out.skipped++; out.skipped_names.push(nameOf(op)); }
        else out.done++;
        save(queued().filter(o => o.id !== op.id));
      }
    } catch { /* storage trouble: try again next time */ }
    if (out.done || out.skipped || out.failed) {
      try { dispatchEvent(new CustomEvent(SYNCED, { detail: out })); } catch { /* no window */ }
    }
    return out;
  })();
  // Cleared after the run settles. An empty queue finishes inside the
  // call above, so a reset there would come before this assignment and
  // leave a settled run in place for good (Tester on #412: going back
  // online sent nothing until a reload).
  running = run;
  run.finally(() => { if (running === run) running = null; });
  return run;
}
