/* Customizable Today (owner, 2026-10-30): Today is a stack of cards the
 * person can reorder, remove and add back, edited in place the way a
 * phone home screen is. The server keeps the order as "today_cards" in
 * settings (api/routes/account.py TODAY_CARDS, same ids); null means
 * the default. A card that is on still hides when it has nothing to
 * say (relevant cards, owner 2026-10-30). */

export const CARD_IDS = ["low", "lists", "report", "price", "expiry", "checks", "patterns", "quest", "watch", "trip"] as const;
export type CardId = (typeof CARD_IDS)[number];

/* Today's order before it was customizable. The cards added later
 * (Price watch, Next trip) start in the card library, off. */
export const DEFAULT_CARDS: CardId[] = ["low", "lists", "report", "price", "expiry", "checks", "patterns", "quest"];

const isCard = (x: unknown): x is CardId => (CARD_IDS as readonly string[]).includes(x as string);

/* The saved order, cleaned: unknown ids and repeats drop out. */
export function cardsOn(saved: unknown): CardId[] {
  if (!Array.isArray(saved)) return DEFAULT_CARDS;
  return saved.filter((c, i) => isCard(c) && saved.indexOf(c) === i) as CardId[];
}

/* Cards not on Today, in the default order: the More cards list. */
export function cardsOff(on: CardId[]): CardId[] {
  return CARD_IDS.filter(c => !on.includes(c));
}

export function moveCard(on: CardId[], id: CardId, to: number): CardId[] {
  const from = on.indexOf(id);
  if (from < 0) return on;
  const next = on.filter(c => c !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

export const removeCard = (on: CardId[], id: CardId): CardId[] => on.filter(c => c !== id);

/* An added card goes to the top, where the person sees it land. */
export const addCard = (on: CardId[], id: CardId): CardId[] => (on.includes(id) ? on : [id, ...on]);

/* The one question, "What matters most to you?". Each answer leads
 * with its cards; nothing is removed, so a skip or a wrong pick never
 * loses a card. */
export const FOCUS_IDS = ["money", "waste", "stock", "faster"] as const;
export type FocusId = (typeof FOCUS_IDS)[number];
export const FOCUS_CARDS: Record<FocusId, CardId[]> = {
  money: ["price", "watch", "patterns"],
  waste: ["expiry", "checks"],
  stock: ["low", "report"],
  faster: ["trip", "lists"],
};

export function cardsForFocus(picked: FocusId[]): CardId[] {
  const lead: CardId[] = [];
  for (const f of FOCUS_IDS) if (picked.includes(f)) for (const c of FOCUS_CARDS[f]) if (!lead.includes(c)) lead.push(c);
  return [...lead, ...DEFAULT_CARDS.filter(c => !lead.includes(c))];
}

/* Card sizes (card library, 2026-10-30), like widget sizes: Small is
 * one line that opens to Medium when tapped, Medium is the usual card
 * (three rows, then "See N more"), Large shows every row. Saved per
 * card as "today_sizes"; absent means Medium. */
export type Size = "s" | "m" | "l";
export const SIZES_OF: Record<CardId, Size[]> = {
  low: ["s", "m", "l"], lists: ["s", "m", "l"], report: ["s", "m", "l"], price: ["s", "m", "l"],
  expiry: ["s", "m", "l"], checks: ["s", "m", "l"], patterns: ["s", "m"], quest: ["s", "m"],
  watch: ["s", "m", "l"], trip: ["s", "m"],
};
export function sizeOf(sizes: unknown, id: CardId): Size {
  const s = sizes && typeof sizes === "object" ? (sizes as Record<string, unknown>)[id] : undefined;
  return SIZES_OF[id].includes(s as Size) ? (s as Size) : "m";
}

/* The card library's groups. */
export const LIBRARY_GROUPS = ["all", "money", "food", "shop"] as const;
export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];
export const CARD_GROUP: Record<CardId, Exclude<LibraryGroup, "all">> = {
  low: "food", lists: "shop", report: "shop", price: "money", expiry: "food", checks: "food", patterns: "money", quest: "shop",
  watch: "money", trip: "shop",
};
