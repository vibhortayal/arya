import { keepRead, savedRead, clearSaved, markServedSaved, markLive } from "./offline";
import { applyQueued, canQueue, enqueue, flush, isLocalId, newOpId, pendingCount, queueable } from "./listQueue";

/* One door to the backend: same paths, same cookies, same error
 * wording as the plain-JS app (pwa/app.js api/post/put). */

/* Server details are short codes for developers; the person reads
 * a sentence (QA 2026-10-28). */
const FRIENDLY: Record<string, string> = {
  "no such session": "This quest ended when the demo reset. Start it again from Today.",
  "no account with that handle": "No one has that username. Check the spelling and try again.",
  "this needs a real account": "Create an account to do this. The demo keeps nothing.",
  // Only a copy run without a Meta key says this (the live site has one):
  // tell whoever runs it what to do (local Docker, 2026-11-02).
  "model_api_key not provisioned on this runtime": "This copy of Arya has no Meta key, so AI features are off. Add MODEL_API_KEY to .env and restart it.",
};

export function friendlyError(d: unknown): string {
  // A structured answer (every item on a list: {code, message, ...})
  // reads as its message; the code and the rest ride on ApiError.detail.
  const m = d && typeof d === "object" ? (d as { message?: unknown }).message : undefined;
  const s = typeof d === "string" ? d : typeof m === "string" ? m : "Something went wrong.";
  const key = s.toLowerCase().replace(/[.\s]+$/, "");
  if (FRIENDLY[key]) return FRIENDLY[key];
  if (key.startsWith("this needs a real account")) return FRIENDLY["this needs a real account"];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class ApiError extends Error {
  /* offer: what the server suggests next (X-Arya-Offer), e.g.
   * "own-key" on a daily-limit answer, "own-key-fix" when the shopper's
   * own Meta key failed (ui/OwnKey.tsx). */
  /* detail: the server's structured answer when it sent one, e.g.
   * {code: "pick_list", lists, suggested, names} or {code: "no_lists"}
   * for an add with no list to go on (every item on a list). */
  constructor(message: string, public status: number, public offer?: string, public detail?: unknown) { super(message); }
}

/* One id per open tab (app.js CLIENT_ID): group live sync
 * (app/groupLive.ts) skips the echo of this tab's own changes. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 12);

/* No request waits forever (speed audit #6): a read gives up after
 * 20 s, a write or a model call (Ask, photo reads) after 130 s. A caller
 * can pass its own signal instead. */
const READ_MS = 20000, WRITE_MS = 130000; // writes outlast the server's own 120 s model timeout
function deadline(ms: number): AbortSignal | undefined {
  const T = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof T === "function" ? T.call(AbortSignal, ms) : undefined;
}

export const OFFLINE_WRITE = "You're offline. List changes save on this phone and sync later, but this one needs a connection. Try again when you're back online.";

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const write = !!opts?.method && opts.method !== "GET";
  if (write) {
    inflight.clear(); fresh.clear();
    // boot.js's early Today is from before this change (re-audit N5).
    if (typeof window !== "undefined" && window.__bootData) window.__bootData.today = undefined;
  }
  // Offline, a change that cannot wait on the phone (anything but a list
  // change, lib/listQueue.ts) says so plainly, at once, instead of waiting.
  if (write && typeof navigator !== "undefined" && navigator.onLine === false) throw new TypeError(OFFLINE_WRITE);
  let r: Response;
  const headers = new Headers(opts?.headers || {});
  headers.set("X-Arya-Client", CLIENT_ID);
  const signal = opts?.signal ?? deadline(write ? WRITE_MS : READ_MS);
  try { r = await fetch(path, { ...opts, headers, ...(signal ? { signal } : {}) }); }
  catch (e) {
    // A network failure (or a timeout) stays a TypeError (the hunt's
    // offline outbox keys on it) but reads as what it is.
    if ((e as Error)?.name === "TimeoutError") throw new TypeError("The connection is too slow right now — try again in a moment.");
    if ((e as Error)?.name === "AbortError") throw e;
    throw new TypeError(write ? OFFLINE_WRITE : "No connection right now. Try again when you're back online.");
  }
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))).detail;
    // The server no longer knows this tab's session (a deploy drops
    // every demo session, re-audit N1): app/session.tsx ends it.
    if (r.status === 401 && detail === "login required" && path.startsWith("/api/")) sessionEnded();
    throw new ApiError(friendlyError(detail || `HTTP ${r.status}`), r.status, r.headers?.get?.("X-Arya-Offer") || undefined,
      detail && typeof detail === "object" ? detail : undefined);
  }
  return r.json();
}

/* Sent once per lost session; app/session.tsx listens. */
export const SESSION_ENDED = "arya-session-ended";
function sessionEnded() { try { dispatchEvent(new Event(SESSION_ENDED)); } catch { /* no window (tests) */ } }

const json = (method: string, body?: unknown): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

/* Two screens asking for the same path while the first read is still
 * on its way (Today and the session both read /api/settings at start)
 * share one request. Each caller gets its own copy, and any write
 * clears the table so a read after a write is never answered with
 * data from before it. */
const inflight = new Map<string, Promise<unknown>>();
/* A few reads that many screens ask for and that only change through
 * this tab's own writes are kept 30 s (speed audit #7): /api/group was
 * fetched by three callers on every screen. Any write clears them. */
// Demo Town's hints were read on every tab switch (re-audit N11).
const KEEP_MS: Record<string, number> = { "/api/group": 30000, "/api/settings": 30000, "/api/town/hints": 30000 };
const fresh = new Map<string, { at: number; p: Promise<unknown> }>();
export const get = <T = any>(path: string): Promise<T> => {
  let p = inflight.get(path) as Promise<T> | undefined;
  const kept = fresh.get(path);
  if (!p && kept && Date.now() - kept.at < (KEEP_MS[path] || 0)) p = kept.p as Promise<T>;
  if (!p) {
    // A good read is kept as the offline copy; with no connection a
    // kept copy answers instead (lib/offline.ts). Server errors (401,
    // 500) are never answered from the copy.
    p = api<T>(path).then(v => { keepRead(path, v); markLive(); return v; }, e => {
      const c = e instanceof TypeError ? savedRead<T>(path) : null;
      if (!c) throw e;
      markServedSaved();
      return c.data;
    });
    inflight.set(path, p);
    const done = () => { if (inflight.get(path) === p) inflight.delete(path); };
    p.then(done, done);
    if (KEEP_MS[path]) {
      const mine = { at: Date.now(), p: p as Promise<unknown> };
      fresh.set(path, mine);
      p.catch(() => { if (fresh.get(path) === mine) fresh.delete(path); });
    }
  }
  return p.then(v => {
    const c = v !== null && typeof v === "object" ? structuredClone(v) : v;
    // Changes still waiting on this phone show as made (lib/listQueue.ts).
    return path === "/api/home" ? applyQueued(c) : c;
  });
};
/* A read the page made itself (boot.js) keeps its copy too. */
export const keepBootRead = keepRead;
export const post = <T = any>(path: string, body?: unknown): Promise<T> =>
  queueable(path) && canQueue() ? postList<T>(path, (body || {}) as Record<string, unknown>) : api<T>(path, json("POST", body));

/* A list change (lib/listQueue.ts): sent with an op id so a retry is
 * applied once; kept on the phone instead when there is no connection,
 * or while older changes are still waiting, so they go out in order. */
async function postList<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const id = newOpId();
  const target = path.startsWith("/api/items/") ? decodeURIComponent(path.split("/")[3]) : body.item_id;
  const keep = () => { const r = enqueue(path, body, id); syncLists(); return r as T; };
  if ((typeof navigator !== "undefined" && navigator.onLine === false) || pendingCount() > 0 || isLocalId(target)) return keep();
  try {
    return await api<T>(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Arya-Op": id }, body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof TypeError) return keep();
    throw e;
  }
}
/* Send the list changes waiting on this phone, if there is signal. */
export const syncLists = () => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(null);
  return flush((p, b, headers) => api(p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(b) }));
};
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, json("PUT", body));
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
/* Multipart upload (receipt photos, audio, shelf shots). */
export const upload = <T = any>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });
/* Another member's change (app/groupLive.ts) can make a kept read
 * stale, e.g. /api/group after someone joins (re-audit N7). */
export const forgetKept = () => { fresh.clear(); };
/* Signing in or out drops every kept read: they were the last account's. */
export const forgetReads = () => { fresh.clear(); inflight.clear(); clearSaved(); };
