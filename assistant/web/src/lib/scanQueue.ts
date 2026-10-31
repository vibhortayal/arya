/* Map my store walks, kept on the phone until there is signal (owner,
 * 2026-10-30: "store the frames offline somewhere and then upload them
 * once the signal is done, and then clear it up").
 *
 * A walk's sharp frames go into IndexedDB as they are taken (small
 * JPEGs, about 6 MB a walk; never the Photos library). When the walk
 * ends, and again whenever the app opens or the phone comes back
 * online, pump() opens a job on the server (POST /api/storemap/jobs),
 * sends the frames one by one, deletes each from the phone once the
 * server has it, and commits. The server reads them in the background
 * (api/scanjobs.py). iPhone web apps cannot upload once closed, so an
 * unsent walk waits for the next time Arya is opened. */
import { api, ApiError, post } from "./api";

export const WALK_MAX_FRAMES = 40;     // what the server reads per walk

export type LocalWalk = {
  id: string; store: string; source: "scan" | "upload"; prices: boolean;
  frames: number; finished: boolean; jobId?: string; sendCount?: number; sent?: number; at: number;
};
export type QueueState = { walks: LocalWalk[]; sending: string | null; online: boolean; error?: string };

const DB = "arya-scan";
const WALKS = "walks", FRAMES = "frames";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(WALKS)) d.createObjectStore(WALKS, { keyPath: "id" });
        if (!d.objectStoreNames.contains(FRAMES)) d.createObjectStore(FRAMES);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const t = (await db()).transaction(stores, mode);
  const done = new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const out = await fn(t);
  await done;
  return out;
}

const fkey = (walk: string, n: number) => `${walk}:${String(n).padStart(4, "0")}`;

async function allWalks(): Promise<LocalWalk[]> {
  return tx([WALKS], "readonly", t => req(t.objectStore(WALKS).getAll() as IDBRequest<LocalWalk[]>));
}
async function putWalk(w: LocalWalk) {
  await tx([WALKS], "readwrite", t => req(t.objectStore(WALKS).put(w)));
}
async function getFrame(walk: string, n: number): Promise<Blob | undefined> {
  return tx([FRAMES], "readonly", t => req(t.objectStore(FRAMES).get(fkey(walk, n)) as IDBRequest<Blob | undefined>));
}
async function delFrame(walk: string, n: number) {
  await tx([FRAMES], "readwrite", t => req(t.objectStore(FRAMES).delete(fkey(walk, n))));
}
async function dropWalk(id: string, frames: number) {
  await tx([WALKS, FRAMES], "readwrite", t => {
    t.objectStore(WALKS).delete(id);
    for (let n = 0; n < frames; n++) t.objectStore(FRAMES).delete(fkey(id, n));
  });
}

/* ---- the walk being recorded ---- */

export async function startWalk(store: string, source: LocalWalk["source"], prices: boolean): Promise<LocalWalk> {
  const w: LocalWalk = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), store, source, prices,
    frames: 0, finished: false, at: Date.now() };
  await putWalk(w);
  return w;
}

/* One sharp frame, saved at once so a crash or a closed app keeps it. */
export async function addFrame(w: LocalWalk, blob: Blob) {
  const n = w.frames;
  w.frames = n + 1;
  await tx([WALKS, FRAMES], "readwrite", t => {
    t.objectStore(FRAMES).put(blob, fkey(w.id, n));
    t.objectStore(WALKS).put(w);
  });
}

/* The walk is over. A long walk keeps an even spread of its frames
 * (the server reads WALK_MAX_FRAMES); the rest are deleted now. */
export async function finishWalk(w: LocalWalk) {
  const keep = spread(w.frames, WALK_MAX_FRAMES);
  await tx([WALKS, FRAMES], "readwrite", async t => {
    const fs = t.objectStore(FRAMES);
    const blobs: (Blob | undefined)[] = await Promise.all(keep.map(n => req(fs.get(fkey(w.id, n)) as IDBRequest<Blob | undefined>)));
    for (let n = 0; n < w.frames; n++) fs.delete(fkey(w.id, n));
    let m = 0;
    for (const b of blobs) if (b) fs.put(b, fkey(w.id, m++));
    w.frames = m; w.finished = true;
    t.objectStore(WALKS).put(w);
  });
  emit();
  void pump();
}

export async function discardWalk(w: LocalWalk) {
  await dropWalk(w.id, w.frames);
  emit();
}

/* Which of n frames to keep so at most max remain, evenly spread. */
export function spread(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.floor((i + 0.5) * n / max));
}

/* ---- sending ---- */

let sending: string | null = null;
let lastError: string | undefined;
let pumping = false;
const subs = new Set<(s: QueueState) => void>();

async function snapshot(): Promise<QueueState> {
  let walks: LocalWalk[] = [];
  try { walks = (await allWalks()).filter(w => w.finished); } catch { /* private mode: nothing kept */ }
  return { walks, sending, online: navigator.onLine !== false, error: lastError };
}
function emit() { void snapshot().then(s => subs.forEach(f => f(s))); }

export function subscribe(f: (s: QueueState) => void): () => void {
  subs.add(f);
  void snapshot().then(f);
  return () => { subs.delete(f); };
}

async function putFrame(job: string, n: number, blob: Blob) {
  const r = await fetch(`/api/storemap/jobs/${job}/frames/${n}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
  if (r.status === 400 || r.status === 404) return false;     // refused for good: skip this frame
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return true;
}

/* Send every finished walk that is still on the phone. Safe to call
 * any time; one pump runs at once. A failure leaves the walk where it
 * is for the next try. */
export async function pump(): Promise<void> {
  if (pumping || navigator.onLine === false) { emit(); return; }
  pumping = true;
  try {
    for (const w of await allWalks()) {
      if (!w.finished) continue;
      sending = w.id; lastError = undefined; emit();
      if (!w.frames) { await dropWalk(w.id, 0); continue; }
      if (!w.jobId) {
        const job = await post<{ id: string; total: number }>("/api/storemap/jobs",
          { store: w.store, frames: w.frames, source: w.source, prices: w.prices });
        w.jobId = job.id; w.sendCount = job.total; w.sent = 0;
        await putWalk(w);
      }
      const count = Math.min(w.sendCount ?? w.frames, w.frames);
      for (let n = w.sent || 0; n < count; n++) {
        const blob = await getFrame(w.id, n);
        if (blob) await putFrame(w.jobId, n, blob);
        await delFrame(w.id, n);
        w.sent = n + 1;
        await putWalk(w);
        emit();
      }
      try { await api(`/api/storemap/jobs/${w.jobId}/commit`, { method: "POST" }); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }   // the job is gone: nothing to commit
      await dropWalk(w.id, w.frames);
      window.dispatchEvent(new CustomEvent("arya-scan-sent", { detail: { store: w.store } }));
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  } finally {
    sending = null; pumping = false; emit();
  }
}

/* Start once per app: send when the app opens, when the phone is back
 * online, and every so often while something is waiting. */
let started = false;
export function startQueue() {
  if (started || typeof indexedDB === "undefined") return;
  started = true;
  window.addEventListener("online", () => { void pump(); });
  window.addEventListener("offline", emit);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void pump(); });
  window.setInterval(() => { if (!pumping) void allWalks().then(ws => { if (ws.some(w => w.finished)) void pump(); }).catch(() => {}); }, 20000);
  void pump();
}
