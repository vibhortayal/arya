/* The hunt's shared state and pure helpers, ported from pwa/quest.js
 * (Q, qProgress .. qStops, the outbox, qCheck/qSetState/qRevive) so
 * the hunt and Express read one copy. Like the old app, the session
 * object is mutated in place (Object.assign) and the open screen
 * repaints through Q.repaint. */
import { ApiError, get, post } from "../../lib/api";
import { clearOnSignOut } from "../../app/session";
import type { SceneDriver } from "../../ui/Scene";
import { toastGlobal } from "../../ui/Toast";

export type Item = {
  name: string; qty: number; checked?: boolean; group?: string; unit?: string; note?: string; variant?: string;
  wild?: boolean; added_mid_hunt?: boolean; shelf_label?: string | null; shelf_u?: number | null;
  shelf_side?: string | null; swapped_from?: string;
};
export type LeftEntry = Item & { how?: string; idx?: number; at?: string; swapped_for?: string };
export type Session = {
  id: string; store: string; mode: string; state: string; driver?: string; store_id?: string | null;
  items: Item[]; left?: LeftEntry[];
  boss?: { group: string; name: string; reports: number } | null;
  started_at?: string | null; finished_at?: string | null;
  new_sticker?: unknown; forgot?: unknown;
  [k: string]: unknown;
};
export type Report = { item: string; item_group?: string; session_id?: string };
export type PlanItem = { name: string; item_id?: string; stores?: Record<string, number>; due?: number; every_days?: number; days_since?: number };
export type Plan = { list: unknown[]; items: PlanItem[] };
export type Found = { line: string; at: string };

type Toast = (msg: string, opts?: { action?: string; onAction?: () => void }) => void;

/* quest.js Q, the parts the hunt and Express use. */
export const Q = {
  current: null as Session | null,
  sessions: [] as Session[],
  storeReports: [] as Report[],
  focusIdx: -1,
  combo: 0,
  found: {} as Record<string, Found>,
  uiSid: "",
  plan: null as Plan | null,
  grabbing: new Set<string>(),
  // The navigation-first walk (Discussion 35 + 36).
  walkTimer: 0 as number,
  walkTarget: -1,
  arrived: false,
  followHold: false,
  scene: null as SceneDriver | null,
  scanTarget: null as string | null,
  // The open screen's repaint and toast (set while a hunt or run is up).
  repaint: null as (() => void) | null,
  notify: null as Toast | null,
};

clearOnSignOut(() => {
  Q.current = null; Q.sessions = []; Q.storeReports = []; Q.focusIdx = -1; Q.combo = 0; Q.found = {};
  Q.uiSid = ""; Q.plan = null; Q.grabbing.clear(); Q.scanTarget = null;
  for (const k of Object.keys(QFRESH)) delete QFRESH[k];
});

export const QMODE_LABEL: Record<string, string> = { quest: "Quest", express: "Express" };
export const QPTS = { item: 10, haul: 25, receipt: 50, boss: 40 };

export function qnorm(s: unknown): string { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function qClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function qAgo(iso?: string | null): string {
  const t = Date.parse(iso || "");
  if (!t) return "recently";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function qParseLines(text: string): { name: string; qty: number }[] {
  const out: { name: string; qty: number }[] = [];
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

/* A row the shopper reported missing on THIS trip. */
export function qIsReportedByMe(sess: Session | null, it: Item | null | undefined): boolean {
  if (!sess || !it) return false;
  const key = qnorm(it.name);
  return (Q.storeReports || []).some(r => r.session_id === sess.id &&
    ((r.item_group && r.item_group === it.group) || qnorm(r.item) === key));
}

export function qProgress(sess: Session) {
  const done = sess.items.filter(i => i.checked).length;
  const reported = sess.items.filter(i => !i.checked && qIsReportedByMe(sess, i)).length;
  const total = sess.items.length - reported;
  return { done, total, left: total - done };
}

export function qHandled(sess: Session) {
  const items = sess.items || [], left = sess.left || [];
  let handled = left.length;
  for (const it of items) if (it.checked || qIsReportedByMe(sess, it)) handled++;
  return { handled, total: items.length + left.length };
}

export function qBossStatus(sess: Session): "none" | "open" | "found" | "left" {
  const b = sess.boss;
  if (!b) return "none";
  const items = sess.items || [];
  if (items.some(i => i.group === b.group && i.checked)) return "found";
  if (items.some(i => i.group === b.group)) return "open";
  return "left";
}

export function qHaulPoints(sess: Session, withReceipt: boolean): number {
  const p = qProgress(sess);
  return p.done * QPTS.item + (p.total && p.done === p.total ? QPTS.haul : 0)
    + (qBossStatus(sess) === "found" ? QPTS.boss : 0)
    + (withReceipt ? QPTS.receipt : 0);
}

export function qNoteOf(it: Item): string {
  return [it.note, it.variant].map(t => String(t || "").trim()).filter(Boolean).join(" · ");
}

export function qSpottedLine(item: Item, now?: Date): string {
  const d = now || new Date();
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `Spotted ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}` + (item.shelf_label ? ` - ${item.shelf_label}` : "");
}
export function qPinFound(item: Item, now?: Date): Found {
  Q.found[item.name] = { line: qSpottedLine(item, now), at: (now || new Date()).toISOString() };
  return Q.found[item.name];
}

/* The pinned finder lines and combo, per session on this phone. */
const QHUNTUI_KEY = "arya-hunt-ui";
type HuntUi = { v: 1; s: { sid: string; combo: number; found: Record<string, Found>; at: number }[] };
let qHuntUiMem: HuntUi = { v: 1, s: [] };
function qHuntUiRead(): HuntUi {
  try {
    const raw = localStorage.getItem(QHUNTUI_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.v === 1 && Array.isArray(d.s)) return d;
    }
  } catch { /* memory fallback */ }
  return qHuntUiMem;
}
export function qHuntUiLoad(sid: string) {
  const e = qHuntUiRead().s.find(x => x && x.sid === sid);
  return {
    combo: e && Number(e.combo) > 0 ? Math.floor(Number(e.combo)) : 0,
    found: e && e.found && typeof e.found === "object" ? e.found : {},
  };
}
export function qHuntUiSave(sess: Session | null) {
  if (!sess || !sess.id) return;
  const d = qHuntUiRead();
  const entry = { sid: sess.id, combo: Q.combo || 0, found: Q.found || {}, at: Date.now() };
  const next: HuntUi = { v: 1, s: [entry, ...d.s.filter(x => x && x.sid !== sess.id)].slice(0, 6) };
  qHuntUiMem = next;
  try { localStorage.setItem(QHUNTUI_KEY, JSON.stringify(next)); } catch { /* blocked */ }
}

/* The first open row (a reported row is handled, not open). */
export function qNextIndex(sess: Session): number {
  return sess.items.findIndex(i => !i.checked && !qIsReportedByMe(sess, i));
}
/* The presented stop: the steer, else the first open row. */
export function qCurrentIndex(sess: Session | null): number {
  if (!sess) return -1;
  if (sess.mode !== "quest") return qNextIndex(sess);
  const f = Q.focusIdx;
  if (f >= 0 && f < sess.items.length && !sess.items[f].checked && !qIsReportedByMe(sess, sess.items[f])) return f;
  return qNextIndex(sess);
}
export function qRetarget(sess: Session, idx: number): number {
  let t = sess.items.findIndex((it, i) => i > idx && !it.checked && !qIsReportedByMe(sess, it));
  if (t === -1) t = qNextIndex(sess);
  Q.focusIdx = t;
  return t;
}
export function qStopU(sess: Session, i: number): number {
  const it = sess.items[i];
  if (it && it.shelf_u != null) return Math.max(0, Math.min(1, it.shelf_u));
  const n = Math.max(1, sess.items.length);
  return (i + 0.5) / n;
}
export function qStops(sess: Session) {
  const flagged = new Set(Q.storeReports.map(r => r.item_group || qnorm(r.item)));
  return sess.items.map(i => ({
    name: i.name, qty: i.qty, checked: !!i.checked,
    flagged: flagged.has(i.group || "") || flagged.has(qnorm(i.name)),
    shelfLabel: i.shelf_label || null,
    shelfU: i.shelf_u === undefined ? null : i.shelf_u,
    shelfSide: i.shelf_side || null,
    unplaced: i.shelf_label !== undefined && i.shelf_u == null,
  }));
}
export async function qLoadStoreReports(store: string) {
  try {
    const d = await get<{ reports?: Report[] }>(`/api/quest/stores/${encodeURIComponent(store)}/reports`);
    Q.storeReports = d.reports || [];
  } catch { Q.storeReports = []; }
}

/* Usuals at this store not on the list (quest.js qPlanUsuals, against the hunt's plan). */
function qSameStore(a: string, b: string) {
  const x = qnorm(a), y = qnorm(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
}
function qStoreCount(rec: PlanItem, store: string) {
  return Object.entries(rec.stores || {}).reduce((n, [s, c]) => n + (qSameStore(s, store) ? c : 0), 0);
}
export function qPlanUsuals(plan: Plan, store: string) {
  const listRows = (plan.list || []) as { name: string; history_id?: string; item_id?: string }[];
  const onList = new Set(listRows.map(i => qnorm(i.name)));
  const onListIds = new Set(listRows.map(i => i.history_id || i.item_id));
  return (plan.items || [])
    .filter(i => qStoreCount(i, store) >= 2 && !onList.has(qnorm(i.name)) && !onListIds.has(i.item_id))
    .map(i => ({ ...i, ripe: i.every_days ? (i.days_since || 0) / i.every_days : 0 }))
    .sort((a, b) => ((b.due || 0) - (a.due || 0)) || (b.ripe - a.ripe) || (qStoreCount(b, store) - qStoreCount(a, store)))
    .slice(0, 6);
}

/* Fresh shelf photos: one fetch per store+item per visit. */
export type Fresh = { image?: string; box?: [number, number, number, number]; seen_at?: string } | null;
export const QFRESH: Record<string, Fresh> = {};
export const freshKey = (store: string, name: string) => qnorm(store) + "|" + qnorm(name || "");

/* ---- server calls that survive a demo reset and a dropped signal ---- */

const Q_GONE = "That hunt is gone — the demo resets now and then. Go back to Today and start it again.";
/* api.ts turns "no such session" into Q_GONE's sentence; match both. */
export function qSessionGone(e: unknown): boolean {
  return !(e instanceof TypeError) && /no such session|that hunt is gone/i.test((e as Error)?.message || "");
}
export async function qRevive(sess: Session): Promise<Session> {
  const fresh = await post<Session>("/api/quest/sessions", {
    store: sess.store, mode: sess.mode, driver: sess.driver,
    store_id: sess.store_id || undefined,
    items: (sess.items || []).filter(i => !i.wild).map(i => ({ name: i.name, qty: i.qty })),
  });
  let cur = fresh;
  for (const i of sess.items || []) {
    if (i.wild) cur = await post<Session>(`/api/quest/sessions/${fresh.id}/items`, { name: i.name, qty: i.qty, wild: true });
    if (i.checked) cur = await post<Session>(`/api/quest/sessions/${fresh.id}/check`, { item: i.name, checked: true });
  }
  Object.assign(sess, cur);
  qLoadSessions().catch(() => {});
  return sess;
}
export async function qLoadSessions(): Promise<Session[]> {
  const d = await get<{ sessions: Session[] }>("/api/quest/sessions");
  Q.sessions = d.sessions || [];
  return Q.sessions;
}
export async function qSetState(sess: Session, state: string): Promise<Session> {
  // Checks queued offline land before the run changes state (finish,
  // pause, abandon), so a closed hunt never misses them.
  if (qOutbox().length) await qFlushOutbox();
  try {
    Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/state`, { state }));
  } catch (e) {
    if (!qSessionGone(e)) throw e;
    try {
      await qRevive(sess);
      Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/state`, { state }));
    } catch { throw new Error(Q_GONE); }
  }
  return sess;
}

/* The offline outbox (this device, in order). */
const QOUT_KEY = "arya-outbox";
export type OutEntry = { sid: string; item?: string; checked?: boolean; op?: string; body?: Record<string, unknown> };
export function qOutbox(): OutEntry[] {
  try { return JSON.parse(localStorage.getItem(QOUT_KEY) || "[]"); } catch { return []; }
}
export function qOutboxSave(list: OutEntry[]) {
  try { localStorage.setItem(QOUT_KEY, JSON.stringify(list)); } catch { /* blocked */ }
}
export async function qCheck(sess: Session, itemName: string, checked: boolean): Promise<Session> {
  if (qOutbox().length) await qFlushOutbox();
  try {
    Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/check`, { item: itemName, checked }));
    return sess;
  } catch (e) {
    const it = (sess.items || []).find(i => i.name === itemName);
    if (qSessionGone(e)) {
      try {
        await qRevive(sess);
        Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/check`, { item: itemName, checked }));
        return sess;
      } catch { throw new Error(Q_GONE); }
    }
    if (!(e instanceof TypeError) || !it) throw e;
    it.checked = checked;
    qOutboxSave([...qOutbox(), { sid: sess.id, item: itemName, checked }]);
    Q.repaint?.();
    return sess;
  }
}
const QOUT_OPS = ["leave", "restore", "edit", "forgot"];
let qFlushRun: Promise<void> | null = null;
export function qFlushOutbox(): Promise<void> {
  if (qFlushRun) return qFlushRun;
  if (!qOutbox().length) { Q.repaint?.(); return Promise.resolve(); }
  qFlushRun = qFlushLoop().finally(() => { qFlushRun = null; Q.repaint?.(); });
  return qFlushRun;
}
async function qFlushLoop() {
  let synced = 0, refetch = false, offlineAgain = false;
  const sid = Q.current && Q.current.id;
  while (qOutbox().length) {
    const e = qOutbox()[0];
    try {
      let s: Session | null = null;
      if (!e.op) s = await post<Session>(`/api/quest/sessions/${e.sid}/check`, { item: e.item, checked: e.checked });
      else if (QOUT_OPS.includes(e.op)) s = await post<Session>(`/api/quest/sessions/${e.sid}/${e.op}`, e.body || {});
      if (s && Q.current && Q.current.id === e.sid) {
        delete s.forgot;
        Object.assign(Q.current, s);
        delete Q.current.new_sticker;
      }
      if (s) synced++;
      else if (e.sid === sid) refetch = true;
    } catch (err) {
      if (err instanceof TypeError) { offlineAgain = true; break; }
      if (e.sid === sid) refetch = true;
    }
    qOutboxSave(qOutbox().slice(1));
  }
  if (refetch && !offlineAgain && Q.current && Q.current.id === sid) {
    try {
      const fresh = await get<Session>(`/api/quest/sessions/${sid}`);
      if (fresh && fresh.id === sid && Q.current && Q.current.id === sid) {
        Object.assign(Q.current, fresh);
        delete Q.current.new_sticker;
      }
    } catch { /* keep what the phone shows */ }
  }
  if (synced) (Q.notify || toastGlobal)(`Back online. ${synced} change${synced === 1 ? "" : "s"} synced.`);
}
/* quest.js: the outbox flushes on reconnect whatever screen is up. */
if (typeof window !== "undefined") window.addEventListener("online", () => { qFlushOutbox(); });
/* The offline line (quest.js qPaintOffline), or "" when hidden. */
export function qOfflineText(): string {
  const n = qOutbox().length, off = navigator.onLine === false;
  if (!off && !n) return "";
  return off
    ? `Offline. Keep going. Changes save on this phone${n ? ` (${n} waiting)` : ""} and sync when you are back.`
    : `Syncing ${n} change${n === 1 ? "" : "s"}…`;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const isApiError = (e: unknown) => e instanceof ApiError;
