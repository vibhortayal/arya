/* Has this account opened the Quest tab yet? Today's "Make your next
 * trip a quest" nudge shows only until the first open, then retires
 * (usability pass, owner 2026-10-29). The settings API has no flag for
 * this, so it is per account in this browser's storage; when storage
 * is blocked the nudge keeps showing, which is harmless. */
const key = (user: string | null | undefined) => `arya-quest-opened:${user || "guest"}`;

export function questOpened(user: string | null | undefined): boolean {
  try { return localStorage.getItem(key(user)) === "1"; } catch { return false; }
}

export function markQuestOpened(user: string | null | undefined): void {
  try { localStorage.setItem(key(user), "1"); } catch { /* storage unavailable */ }
}
