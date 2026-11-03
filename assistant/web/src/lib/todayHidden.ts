/* Rows hidden from Today with their ✕ (owner, 2026-11-03: "all card
 * items" get hide). A hide is for this account only and never deletes
 * data. Stored in settings.today_hidden as key -> "signature|YYYY-MM-DD".
 * A row comes back when its signature changes (bought again, a new
 * month, a new price gap) or when the hide is older than its kind's
 * limit (store alerts clear after 3 days, so 4; price rows 30). */
export type Hidden = Record<string, string>;

const TTL_DAYS: Record<string, number> = { r: 4, p: 30, w: 30 };

export const today = () => new Date().toISOString().slice(0, 10);

export function hideValue(sig: string, day = today()): string {
  return `${sig}|${day}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function isHidden(map: Hidden | null | undefined, key: string, sig: string, day = today()): boolean {
  const v = map?.[key];
  if (!v) return false;
  const cut = v.lastIndexOf("|");
  const was = v.slice(0, cut), at = v.slice(cut + 1);
  if (was !== sig) return false;
  const ttl = TTL_DAYS[key.split(":")[0]];
  return ttl == null || !(daysBetween(at, day) > ttl);
}
