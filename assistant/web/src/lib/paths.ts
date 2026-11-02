/* Address checks the shell makes before any screen loads. They live
 * here, not in their screens, so the shell can lazy-load those screens
 * (speed audit #17). */
export const DEV_PATH = "/developers";
export const isDevelopersPath = (path: string) => path.replace(/\/+$/, "") === DEV_PATH;

/* An invite link (/?join=CODE). The code is also kept on this phone for
 * two days, so it survives signing in (a Google sign-in or an email code
 * can come back to a plain address) and opens Join after sign-in
 * (owner's group test, 2026-11-01). */
const JOIN_KEY = "arya.join";
const JOIN_MS = 2 * 86400 * 1000;
export function stashJoinCode(): void {
  try {
    const c = new URLSearchParams(location.search).get("join");
    if (c) localStorage.setItem(JOIN_KEY, JSON.stringify({ c, t: Date.now() }));
  } catch { /* private mode: the address still has it */ }
}
export function joinCodeFromUrl(): string {
  try {
    const c = new URLSearchParams(location.search).get("join");
    if (c) return c;
  } catch { /* fall through */ }
  try {
    const kept = JSON.parse(localStorage.getItem(JOIN_KEY) || "null");
    if (kept && typeof kept.c === "string" && Date.now() - kept.t < JOIN_MS) return kept.c;
  } catch { /* nothing kept */ }
  return "";
}
export function forgetJoinCode(): void {
  try { localStorage.removeItem(JOIN_KEY); } catch { /* nothing kept */ }
}
