/* A saved copy of the last good read of the core screens, so the
 * installed app opens and can be read with no signal. Read-only: no
 * write is ever queued here (the hunt and Map my store keep their own
 * outboxes).
 *
 * What is kept: the JSON body of a few GET reads (lists, Today,
 * settings, groups, stores, powers, receipts, Quest profile). Never a
 * cookie or token (the sign-in is an HttpOnly cookie the page cannot
 * read), never the demo (it keeps nothing), never a body over 400 KB.
 * Copies are filed under the signed-in account and are all deleted at
 * sign-in and sign-out (forgetReads in lib/api.ts). */

const PREFIX = "arya.rc:";
const MAX_BYTES = 400_000;
/* Exact paths (no query string): the screens a person opens to read. */
export const SAVED_PATHS = new Set([
  "/api/home", "/api/today", "/api/settings", "/api/group", "/api/stores/mine",
  "/api/powers", "/api/quest/profile", "/api/quest/receipts", "/api/prices/insights",
]);

export function account(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem("arya.lastUser") || "null");
    return v && typeof v.user === "string" && !v.demo ? v.user : null;
  } catch { return null; }
}
const keyFor = (path: string) => { const u = account(); return u && SAVED_PATHS.has(path) ? `${PREFIX}${u}:${path}` : null; };

export function keepRead(path: string, data: unknown): void {
  const k = keyFor(path);
  if (!k) return;
  try {
    const body = JSON.stringify({ at: Date.now(), data });
    if (body.length <= MAX_BYTES) localStorage.setItem(k, body);
  } catch { /* storage full or private mode: no copy */ }
}

export function savedRead<T = unknown>(path: string): { at: number; data: T } | null {
  const k = keyFor(path);
  if (!k) return null;
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v && typeof v.at === "number" ? v : null;
  } catch { return null; }
}

export function clearSaved(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch { /* nothing to clear */ }
}

/* "Offline" for the bar: the phone says so, or a read just had to be
 * answered from the saved copy. A good read, or the signal coming
 * back, clears the second reason. */
let served = false;
const EVT = "arya-offline-change";
export const markServedSaved = () => { if (!served) { served = true; dispatchEvent(new Event(EVT)); } };
export const markLive = () => { if (served) { served = false; dispatchEvent(new Event(EVT)); } };
export const isOffline = () => (typeof navigator !== "undefined" && navigator.onLine === false) || served;
export function subscribeOffline(fn: () => void): () => void {
  for (const e of [EVT, "online", "offline"]) addEventListener(e, fn);
  return () => { for (const e of [EVT, "online", "offline"]) removeEventListener(e, fn); };
}
