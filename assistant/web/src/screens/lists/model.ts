import { clearOnSignOut } from "../../app/session";
import { fmtShort } from "../../lib/format";
import { t } from "../../i18n";

/* Data helpers for the Lists tab, ported from pwa/app.js (namedLists,
 * itemHome, suggestHome, suggestWhy, qSameStore). The character
 * registry is lib/characters.ts. */

export type Item = {
  item_id: string; name: string; on_list?: boolean; checked?: boolean; list?: string | null;
  qty?: number; unit?: string; added_by?: string; also?: string[]; checked_in?: string[]; aisle?: string; not_grocery?: boolean; source?: string;
  expired_on?: string; every_days?: number; days_since?: number; due_reason?: string; judge_reason?: string;
};
export type NamedList = { id: string; name: string; stores?: string[] };
export type HomeData = {
  list: { items: Item[] };
  lists?: NamedList[];
  price_by_store?: Record<string, Record<string, { count: number; median: number }>>;
};

const qnorm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/* A receipt says "Costco"; the directory says "Costco Wholesale". */
export function sameStore(a: unknown, b: unknown) {
  const x = qnorm(a), y = qnorm(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
}

export const namedLists = (d: HomeData | null): NamedList[] => (d && d.lists) || [];
/* An item on more than one list shows once per list (owner, 2026-10-30):
 * each copy has that list as its `list`, its own tick, and `also` names
 * the other lists it is on. */
export const onListItems = (d: HomeData) => d.list.items.filter(i => i.on_list).flatMap(i => [i,
  ...(i.also || []).map(a => ({ ...i, list: a, checked: (i.checked_in || []).includes(a),
    also: [i.list || "", ...(i.also || []).filter(x => x !== a)].filter(Boolean), checked_in: [] }))]);
/* The names of the other lists a row is on, for its quiet line. */
export const alsoNames = (d: HomeData, i: Item) =>
  (i.also || []).map(id => namedLists(d).find(l => l.id === id)?.name || "").filter(Boolean);
export const suggestions = (d: HomeData) => d.list.items.filter(i => !i.on_list);
export const lensName = (d: HomeData | null, id: string) =>
  id === "else" ? t("common.everythingElse") : ((namedLists(d).find(l => l.id === id) || {} as Partial<NamedList>).name || "");

/* Where an item lives: its named list, or "else". */
export function itemHome(d: HomeData, i: Item): string {
  return i.list && namedLists(d).some(l => l.id === i.list) ? i.list : "else";
}

/* Where a suggestion shows: the list it is filed under, else the list
 * linked to the store it is bought at most, else Everything else. */
export function suggestHome(d: HomeData, i: Item): string {
  if (i.list && namedLists(d).some(l => l.id === i.list)) return i.list;
  const pbs = (d.price_by_store || {})[i.item_id] || {};
  const stores = Object.entries(pbs).sort((a, b) => b[1].count - a[1].count).map(([s]) => s);
  for (const s of stores) {
    const l = namedLists(d).find(l => (l.stores || []).some(x => sameStore(x, s)));
    if (l) return l.id;
  }
  return "else";
}

/* One short reason for a suggestion row; the sheet has the rest. */
export function suggestWhy(i: Item): string {
  if (i.expired_on) return t("lists.why.expiredOn", { date: fmtShort(i.expired_on) });
  if (i.every_days) {
    const left = i.every_days - (i.days_since || 0);
    return t("lists.why.every", { days: i.every_days }) + " · " + (left <= 0 ? t("lists.why.dueNow") : t("lists.why.dueIn", { count: left }));
  }
  return i.due_reason || i.judge_reason || t("lists.why.thinksDue");
}

/* "To ask" items the New list plan skipped (quest.js qAskLaterHas). */
export function askLaterHas(name: string): boolean {
  try { return (JSON.parse(localStorage.getItem("arya-ask-later") || "[]") as string[]).includes(qnorm(name)); }
  catch { return false; }
}

/* The lens (which list is open) survives leaving the tab, as the old
 * module-level listLens did; it resets on sign out. */
export const lensState = { lens: "home" };
clearOnSignOut(() => { lensState.lens = "home"; });

/* The last /api/home the tab painted, so a re-open shows the list at
 * once and refreshes behind it (app.js listData). */
export const cache: { data: HomeData | null } = { data: null };
clearOnSignOut(() => { cache.data = null; });
