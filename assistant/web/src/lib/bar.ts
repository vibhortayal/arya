import { PARENT_TAB, type ViewId } from "../app/views";

/* The customizable bottom bar (owner, 2026-11-01; mockups
 * PTRdHtv8EBtsgXnsLuthdM and 7icjAbBu8egXBZ94WrXvg4): four places the
 * shopper picks, then More, which is always there and holds the rest.
 * Saved per account as layouts.bar.on (api/routes/account.py, same
 * ids); null or missing means the default. No renaming and no custom icons:
 * each place keeps its own name and icon everywhere, so the Tour, the
 * Arya guide, Help and Ask can name it. */

export const BAR_ITEMS = ["home", "list", "receipts", "stores-mine", "analysis", "chat", "community", "help", "profile"] as const satisfies readonly ViewId[];
export type BarItem = (typeof BAR_ITEMS)[number];

/* The default (owner pick, 2026-11-02): Today, Spending, Quest, Ask, More.
 * Lists, Receipts, Stores, Help and Settings sit in More. */
export const DEFAULT_BAR: BarItem[] = ["home", "analysis", "community", "chat"];
export const BAR_MAX = 4;

export const isBarItem = (x: unknown): x is BarItem => (BAR_ITEMS as readonly string[]).includes(x as string);

/* The saved bar, cleaned: unknown ids and repeats drop out, four at
 * most. Nothing saved, or nothing left, is the default. */
export function barOf(saved: unknown): BarItem[] {
  if (!Array.isArray(saved)) return DEFAULT_BAR;
  const on = saved.filter((c, i) => isBarItem(c) && saved.indexOf(c) === i).slice(0, BAR_MAX) as BarItem[];
  return on.length ? on : DEFAULT_BAR;
}

/* Places in More: everything not on the bar, in BAR_ITEMS order. */
export const moreOf = (bar: BarItem[]): BarItem[] => BAR_ITEMS.filter(i => !bar.includes(i));

/* A pushed page's own place when that place can be pinned: Receipts and
 * Stores live on Spending (owner, 2026-11-02). */
const OWN: Partial<Record<ViewId, BarItem>> = {
  receipt: "receipts", tocheck: "receipts", "stores-find": "stores-mine",
};
const HOME_OF: Partial<Record<BarItem, BarItem>> = { receipts: "analysis", "stores-mine": "analysis" };

/* Which bar button lights for a screen: the screen itself, or its place,
 * or the tab it lives under; "more" when none of those is on the bar. */
export function litTab(view: ViewId, bar: BarItem[]): BarItem | "more" | null {
  const chain: ViewId[] = [view];
  const own = OWN[view];
  if (own) chain.push(own);
  for (const v of [...chain]) {
    const home = isBarItem(v) ? HOME_OF[v] : undefined;
    if (home) chain.push(home);
  }
  const parent = PARENT_TAB[view];
  if (parent) chain.push(parent);
  for (const v of chain) if (isBarItem(v) && bar.includes(v)) return v;
  // A screen with no place in the bar or More (a hunt, a race) lights nothing.
  return chain.some(isBarItem) ? "more" : null;
}

/* The first screen: Today when it is on the bar, else the first place. */
export const startView = (bar: BarItem[]): BarItem => (bar.includes("home") ? "home" : bar[0]);

/* Ask names places from the bar the shopper sees (owner, 2026-11-01):
 * every /api/chat body carries it, so Ask stays in step the moment the
 * bar changes. ui/Bar.tsx keeps `shown` current. */
let shown: BarItem[] = DEFAULT_BAR;
export function setShownBar(bar: BarItem[]) { shown = bar; }
export const withBar = <T extends object>(body: T): T & { bar: BarItem[] } => ({ ...body, bar: shown });
