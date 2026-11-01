import { keepRead, savedRead, clearSaved, markServedSaved, markLive } from "./offline";

/* One door to the backend: same paths, same cookies, same error
 * wording as the plain-JS app (pwa/app.js api/post/put). */

/* Server details are short codes for developers; the person reads
 * a sentence (QA 2026-10-28). */
const FRIENDLY: Record<string, string> = {
  "no such session": "This quest ended when the demo reset. Start it again from Today.",
  "no account with that handle": "No one has that username. Check the spelling and try again.",
  "this needs a real account": "Create an account to do this. The demo keeps nothing.",
  "model_api_key not provisioned on this runtime": "Arya's AI isn't available right now. Try again in a little while.",
};

export function friendlyError(d: unknown): string {
  const s = typeof d === "string" ? d : "Something went wrong.";
  const key = s.toLowerCase().replace(/[.\s]+$/, "");
  if (FRIENDLY[key]) return FRIENDLY[key];
  if (key.startsWith("this needs a real account")) return FRIENDLY["this needs a real account"];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
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

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const write = !!opts?.method && opts.method !== "GET";
  if (write) {
    inflight.clear(); fresh.clear();
    // boot.js's early Today is from before this change (re-audit N5).
    if (typeof window !== "undefined" && window.__bootData) window.__bootData.today = undefined;
  }
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
    throw new TypeError("No connection right now — try again when you're back online.");
  }
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))).detail;
    // The server no longer knows this tab's session (a deploy drops
    // every demo session, re-audit N1): app/session.tsx ends it.
    if (r.status === 401 && detail === "login required" && path.startsWith("/api/")) sessionEnded();
    throw new ApiError(friendlyError(detail || `HTTP ${r.status}`), r.status);
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
  return p.then(v => (v !== null && typeof v === "object" ? structuredClone(v) : v));
};
/* A read the page made itself (boot.js) keeps its copy too. */
export const keepBootRead = keepRead;
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, json("POST", body));
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, json("PUT", body));
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
/* Multipart upload (receipt photos, audio, shelf shots). */
export const upload = <T = any>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });
/* Another member's change (app/groupLive.ts) can make a kept read
 * stale, e.g. /api/group after someone joins (re-audit N7). */
export const forgetKept = () => { fresh.clear(); };
/* Signing in or out drops every kept read: they were the last account's. */
export const forgetReads = () => { fresh.clear(); inflight.clear(); clearSaved(); };
