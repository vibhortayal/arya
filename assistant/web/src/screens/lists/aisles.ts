import type { Item } from "./model";

/* A long list reads better by department (owner, 2026-10-30): from
 * GROUP_AT open items the rows sit under department headers, in the
 * same order the album pages use. The department comes from the
 * server's keyword map (item.aisle); a name it does not know goes under
 * "Other". When the map knows too little the list stays flat, because
 * a pile of "Other" is no better than no headers. */
export const GROUP_AT = 12;
export const FIND_AT = 25;
export const OTHER = "Other";
export const AISLE_ORDER = ["Produce", "Bakery", "Deli", "Dairy", "Pantry", "Frozen", "Household"];

export type AisleGroup = { aisle: string; items: Item[] };

export function groupByAisle(items: Item[]): AisleGroup[] | null {
  if (items.length < GROUP_AT) return null;
  const by = new Map<string, Item[]>();
  for (const i of items) {
    const k = i.aisle && AISLE_ORDER.includes(i.aisle) ? i.aisle : OTHER;
    by.set(k, [...(by.get(k) || []), i]);
  }
  if ((by.get(OTHER)?.length || 0) * 3 > items.length) return null;
  return [...AISLE_ORDER, OTHER].filter(k => by.has(k)).map(k => ({ aisle: k, items: by.get(k)! }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const matchesFind = (i: Item, q: string) => !norm(q) || norm(i.name).includes(norm(q));

/* Which headers the person folded, per list, on this device. */
const KEY = "arya.lists.folded";
export function loadFolded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
export function saveFolded(s: Set<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* private window: the fold just does not stick */ }
}
