/* The Arya guide (#154, owner-approved mockup 2026-10-29; restructured
 * into the owner's sections 2026-10-30): swipeable cards that tell
 * what Arya does, with a "Try it" on most. Cards are data; ui/Guide.tsx
 * draws them and ui/GuideTry.tsx holds the Try-it sheets. Every text
 * field is an en.json key (guide.*).
 *
 * Try it runs on the sample data below, in the browser only: nothing
 * is saved and nothing goes to the server or a model. The one
 * exception is Store maps, whose Try it leaves the guide for the
 * game's own Practice Market (a pretend store that saves nothing). */

export const GUIDE_IDS = ["lists", "share", "maps", "news", "receipts", "prices", "usesoon", "ask", "howto"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

/* A row of a card's sample picture: a label key, an optional value
 * key, and how the value reads (good is green, bad is red). A row with
 * section set is a small store heading instead; bar (0-1) draws a
 * spending bar before the value. */
export type ArtRow = { k: string; v?: string; tone?: "good" | "bad" | "muted"; section?: boolean; bar?: number };

export type GuideArt =
  | { kind: "image"; src: string }
  | { kind: "chars"; names: string[] }
  | { kind: "rows"; headKey?: string; faces?: string[]; rows: ArtRow[] };

export type TryKind = "list" | "share" | "usesoon" | "receipt" | "prices" | "ask" | "quest";

export type GuideCard = {
  id: GuideId;
  kickerKey: string;
  titleKey: string;
  bodyKey?: string;
  pointKeys?: string[];
  art?: GuideArt;
  try?: { kind: TryKind; labelKey: string };
  howtos?: Howto[];
};

export type Howto = { id: string; titleKey: string; stepKeys: string[] };

const k = (id: string) => ({ kickerKey: `guide.cards.${id}.kicker`, titleKey: `guide.cards.${id}.title` });
const steps = (id: string, n: number) => Array.from({ length: n }, (_, i) => `guide.howto.${id}.s${i + 1}`);

/* Each how-to was checked against the app (2026-10-29): the row and
 * button names are the ones the screens show. */
export const HOWTOS: Howto[] = [
  { id: "receipt", titleKey: "guide.howto.receipt.title", stepKeys: steps("receipt", 3) },
  { id: "shop", titleKey: "guide.howto.shop.title", stepKeys: steps("shop", 4) },
  { id: "share", titleKey: "guide.howto.share.title", stepKeys: steps("share", 3) },
  { id: "expiry", titleKey: "guide.howto.expiry.title", stepKeys: steps("expiry", 4) },
  { id: "ask", titleKey: "guide.howto.ask.title", stepKeys: steps("ask", 3) },
];

const A = (k: string) => `guide.sample.art.${k}`;

export const GUIDE_CARDS: GuideCard[] = [
  { id: "lists", ...k("lists"), bodyKey: "guide.cards.lists.body",
    art: { kind: "rows", rows: [
      { k: "guide.sample.store.tj", section: true }, { k: A("milk"), v: "guide.sample.cat.dairy", tone: "muted" },
      { k: A("costco"), section: true }, { k: A("blueberries"), v: "guide.sample.cat.produce", tone: "muted" },
      { k: "guide.sample.store.safeway", section: true }, { k: A("cottage"), v: "guide.sample.cat.dairy", tone: "muted" },
    ] },
    try: { kind: "list", labelKey: "guide.cards.lists.try" } },
  { id: "share", ...k("share"), bodyKey: "guide.cards.share.body",
    art: { kind: "rows", headKey: A("shareHead"), faces: [A("faceYou"), A("facePriya")], rows: [
      { k: A("blueberries"), v: A("priyaTicked"), tone: "good" },
      { k: A("towels"), v: A("priyaAdded"), tone: "good" },
      { k: A("eggs"), v: A("youChanged"), tone: "muted" },
    ] },
    try: { kind: "share", labelKey: "guide.cards.share.try" } },
  { id: "maps", ...k("maps"), bodyKey: "guide.cards.maps.body", art: { kind: "image", src: "assets/scenes/aisle-art.webp" },
    try: { kind: "quest", labelKey: "guide.cards.maps.try" } },
  { id: "news", ...k("news"), bodyKey: "guide.cards.news.body",
    art: { kind: "rows", headKey: A("newsHead"), rows: [
      { k: A("oatMilk"), v: A("outOfStock"), tone: "bad" },
      { k: A("sourdough"), v: A("backInStock"), tone: "good" },
      { k: A("blueberries"), v: A("inStock"), tone: "good" },
    ] } },
  { id: "receipts", ...k("receipts"), bodyKey: "guide.cards.receipts.body",
    art: { kind: "rows", headKey: A("spendHead"), rows: [
      { k: A("costco"), v: A("spendCostco"), bar: 1 },
      { k: "guide.sample.store.tj", v: A("spendTj"), bar: 0.58 },
      { k: "guide.sample.store.safeway", v: A("spendSafeway"), bar: 0.33 },
      { k: A("receiptRow"), v: A("forReturn"), tone: "good" },
    ] },
    try: { kind: "receipt", labelKey: "guide.cards.receipts.try" } },
  { id: "prices", ...k("prices"), bodyKey: "guide.cards.prices.body",
    art: { kind: "rows", headKey: A("oil"), rows: [
      { k: "guide.sample.store.tj", v: A("cheaper"), tone: "good" },
      { k: "guide.sample.store.safeway", v: A("dearer") },
      { k: A("fromShoppers") },
    ] },
    try: { kind: "prices", labelKey: "guide.cards.prices.try" } },
  { id: "usesoon", ...k("usesoon"), bodyKey: "guide.cards.usesoon.body", art: { kind: "chars", names: ["vegetable", "dairy", "fruit"] },
    try: { kind: "usesoon", labelKey: "guide.cards.usesoon.try" } },
  { id: "ask", ...k("ask"), bodyKey: "guide.cards.ask.body", art: { kind: "chars", names: ["compass", "olive-oil", "pasta"] },
    try: { kind: "ask", labelKey: "guide.cards.ask.try" } },
  { id: "howto", ...k("howto"), howtos: HOWTOS },
];

/* Where the guide opens for a card id; an unknown id opens card 1. */
export function guideIndex(id?: string | null): number {
  const i = GUIDE_CARDS.findIndex(c => c.id === id);
  return i < 0 ? 0 : i;
}

/* A power on the Powers page that has a guide card (Powers' (i)
 * sheet links to it). */
export const GUIDE_FOR_POWER: Record<string, GuideId> = {
  lists: "lists", usesoon: "usesoon", receipts: "receipts", patterns: "receipts", compare: "prices", trends: "prices",
  community: "prices", ask: "ask",
};

/* ---- Sample data for Try it (client side only) ---- */

/* A small local aisle table for the sample list: the first rule whose
 * word is in the item's name wins. Values are en.json keys. */
const AISLES: [RegExp, string][] = [
  [/\b(milk|yogh?urt|cheese|butter|eggs?|cream|kefir)\b/i, "guide.try.list.aisle.dairy"],
  [/\b(bananas?|apples?|spinach|lettuce|tomato(es)?|onions?|potato(es)?|avocados?|berries|carrots?|lemons?|limes?|grapes?|fruit|herbs?)\b/i, "guide.try.list.aisle.produce"],
  [/\b(bread|bagels?|sourdough|rolls?|muffins?|croissants?|tortillas?)\b/i, "guide.try.list.aisle.bakery"],
  [/\b(frozen|ice cream|peas)\b/i, "guide.try.list.aisle.frozen"],
  [/\b(pasta|rice|beans|flour|sugar|oil|sauce|cereal|oats|soup|coffee|tea)\b/i, "guide.try.list.aisle.pantry"],
  [/\b(chicken|beef|pork|salmon|fish|turkey|sausages?|tofu)\b/i, "guide.try.list.aisle.meat"],
  [/\b(chips|crackers|cookies|nuts|chocolate|popcorn)\b/i, "guide.try.list.aisle.snacks"],
  [/\b(water|juice|soda|sparkling|wine|beer)\b/i, "guide.try.list.aisle.drinks"],
];

export function guessAisle(name: string): string {
  for (const [re, key] of AISLES) if (re.test(name)) return key;
  return "guide.try.list.aisle.other";
}

/* What the shopper typed, as item names: split on commas and new
 * lines, trimmed, first letter up, no empties or repeats. */
export function parseItems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    const name = s.charAt(0).toUpperCase() + s.slice(1);
    if (!out.some(o => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

export type SampleItem = { name: string; aisleKey: string; justAdded?: boolean };

/* Add typed items at the top, tagged Just added; an item already on
 * the list moves to the top. */
export function addSampleItems(items: SampleItem[], text: string): SampleItem[] {
  const names = parseItems(text);
  if (!names.length) return items;
  const lower = new Set(names.map(n => n.toLowerCase()));
  const rest = items.filter(i => !lower.has(i.name.toLowerCase())).map(i => ({ ...i, justAdded: false }));
  return [...names.map(name => ({ name, aisleKey: guessAisle(name), justAdded: true })), ...rest];
}

/* Sample receipts. Item and store names are en.json keys too. */
export type SampleLine = { nameKey: string; price: number; catKey: string };
export type SampleReceipt = { storeKey: string; lines: SampleLine[] };

const L = (item: string, price: number, cat: string): SampleLine =>
  ({ nameKey: `guide.sample.item.${item}`, price, catKey: `guide.sample.cat.${cat}` });

export const SAMPLE_RECEIPT: SampleReceipt = {
  storeKey: "guide.sample.store.safeway",
  lines: [L("bananas", 1.89, "produce"), L("spinach", 3.49, "produce"), L("milk", 4.29, "dairy"), L("yogurt", 5.49, "dairy"),
    L("bread", 5.99, "bakery"), L("pasta", 2.19, "pantry"), L("oil", 11.49, "pantry")],
};

export const SAMPLE_TWO_STORES: SampleReceipt[] = [
  { storeKey: "guide.sample.store.tj", lines: [L("oil", 8.99, "pantry"), L("eggs", 3.49, "dairy"), L("bananas", 1.49, "produce"), L("pasta", 2.49, "pantry")] },
  { storeKey: "guide.sample.store.safeway", lines: [L("oil", 11.49, "pantry"), L("eggs", 4.29, "dairy"), L("bananas", 1.89, "produce"), L("pasta", 2.19, "pantry")] },
];

export const total = (r: SampleReceipt) => Math.round(r.lines.reduce((s, l) => s + l.price, 0) * 100) / 100;

/* Spending by category for one receipt, biggest first. */
export function byCategory(r: SampleReceipt): { catKey: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const l of r.lines) m.set(l.catKey, (m.get(l.catKey) || 0) + l.price);
  return [...m].map(([catKey, amount]) => ({ catKey, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
}

/* For each item on both receipts: the cheaper store and the saving.
 * Same price on both: no winner. */
export type Compare = { nameKey: string; cheapKey: string | null; cheap: number; dear: number; dearKey: string | null };
export function compareStores([a, b]: SampleReceipt[]): Compare[] {
  const out: Compare[] = [];
  for (const la of a.lines) {
    const lb = b.lines.find(l => l.nameKey === la.nameKey);
    if (!lb) continue;
    const aWins = la.price < lb.price, tie = la.price === lb.price;
    out.push({
      nameKey: la.nameKey,
      cheapKey: tie ? null : aWins ? a.storeKey : b.storeKey,
      dearKey: tie ? null : aWins ? b.storeKey : a.storeKey,
      cheap: Math.min(la.price, lb.price),
      dear: Math.max(la.price, lb.price),
    });
  }
  return out;
}

/* Ask: three sample questions with scripted answers (no model). */
export const SAMPLE_QUESTIONS = ["cook", "spent", "eggs"].map(id => ({ id, qKey: `guide.try.ask.${id}.q`, aKey: `guide.try.ask.${id}.a` }));
