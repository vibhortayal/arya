import { type NamedList } from "./model";

/* The adaptive Lists home (#156, owner-approved mockup 2026-10-29).
 * Few lists show as large cards, more as compact tiles, many as dense
 * rows with search. The count that moves the view to a denser mode is
 * higher than the count that moves it back, so adding or deleting one
 * list does not flip the view. A "Cards" | "List" switch (from 4
 * lists) overrides the automatic mode. All of this is per device. */

export type ListsMode = "large" | "tiles" | "dense";
export type ListsView = "cards" | "list";

/* Denser at 4 and at 12; back only at 3 and at 10. `prev` is the last
 * automatic mode for this account (null when none is stored). */
export function autoMode(count: number, prev: ListsMode | null): ListsMode {
  if (count <= 3) return "large";
  if (count >= 12) return "dense";
  if (prev === "dense" && count >= 11) return "dense";
  return "tiles";
}

/* The mode to paint. Below 4 lists the switch is hidden and the
 * automatic mode applies; from 4 a manual choice wins. */
export function viewMode(count: number, auto: ListsMode, override: ListsView | null): ListsMode {
  if (count < 4 || !override) return auto;
  return override === "list" ? "dense" : "tiles";
}

/* Search: list name or a linked store, case-insensitive. */
export function filterLists<T extends Pick<NamedList, "name" | "stores">>(lists: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return lists;
  return lists.filter(l => l.name.toLowerCase().includes(s) || (l.stores || []).some(x => x.toLowerCase().includes(s)));
}

/* The lists changed or opened most recently (newest first), up to n.
 * A list with no time keeps its place in the list order after the
 * ones that have one; with no times at all this is the list order. */
export function recentLists<T extends Pick<NamedList, "id">>(lists: T[], at: Record<string, number>, n = 5): T[] {
  return lists.map((l, k) => ({ l, k, a: at[l.id] || 0 }))
    .sort((x, y) => (y.a - x.a) || (x.k - y.k))
    .slice(0, n).map(x => x.l);
}

/* ---- per-device memory (private mode: no memory, no error) ---- */

const MODE_KEY = (user: string | null) => `arya-lists-mode:${user || ""}`;
const VIEW_KEY = "arya-lists-view";
const OPENED_KEY = "arya-list-opened";

export function readMode(user: string | null): ListsMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY(user));
    return v === "large" || v === "tiles" || v === "dense" ? v : null;
  } catch { return null; }
}
export function writeMode(user: string | null, m: ListsMode) {
  try { localStorage.setItem(MODE_KEY(user), m); } catch { /* private mode */ }
}
export function readView(): ListsView | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "cards" || v === "list" ? v : null;
  } catch { return null; }
}
export function writeView(v: ListsView) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
}
export function readOpened(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
/* Stamp a list as just opened or changed. Keeps the newest 60 ids. */
export function markOpened(id: string, now = Date.now()) {
  if (!id || id === "home" || id === "else") return;
  try {
    const at = { ...readOpened(), [id]: now };
    const keep = Object.entries(at).sort((a, b) => b[1] - a[1]).slice(0, 60);
    localStorage.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* private mode */ }
}
