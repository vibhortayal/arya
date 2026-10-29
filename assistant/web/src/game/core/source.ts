/* Where the game gets its data, and where its findings go. The game
 * only talks to this interface. The spike ships the sample source
 * (no network); the Arya app will plug in a source that reads the
 * user's lists and the store map API and posts finds and reports. */
import { buildLayout, sectionFor } from "./template";
import type { StoreGraph } from "../map/graph";
import type { Answers } from "../map/answers";
import { PRESETS } from "../map/presets";
import type { QuestItem, ShoppingList, StoreLayout, StoreSummary } from "./types";

export type FieldReport =
  | { kind: "found"; store: string; section: string; item: string }       // fog cleared
  | { kind: "empty" | "elsewhere"; store: string; section: string; item: string }
  | { kind: "route"; store: string; notes: string[]; text: string };

export interface QuestSource {
  lists(): Promise<ShoppingList[]>;
  nearbyStores(): Promise<StoreSummary[]>;
  findStores(query: string): Promise<StoreSummary[]>;
  /* The layout for a store and list, with the spots Arya may show. */
  open(storeId: string, list: ShoppingList): Promise<{ layout: StoreLayout; items: QuestItem[] }>;
  report(r: FieldReport): Promise<void>;
  /* Optional trip hooks for a host that keeps its own records (the
   * Arya app: the hunt session). Practice never calls them. */
  progress?(e: { kind: "grab" | "ungrab"; item: string; instead?: string }): void;
  finish?(e: { got: string[]; points: number }): Promise<void>;
  /* End the trip without finishing it (Leave › End quest): the host
   * closes its record; grabs already sent stay checked off. */
  end?(): Promise<void>;
  /* Build (optional). build: Arya's pass over the store the answers
   * made (names, a cuisine's items); it answers the store it was given
   * when it cannot do better. change: one edit said in a sentence.
   * maps/saveMap: the player's saved stores (My map for a real store,
   * or a dream store). voice: record and transcribe one answer. */
  build?(answers: Answers, base: StoreGraph): Promise<StoreGraph>;
  change?(graph: StoreGraph, say: string): Promise<{ graph: StoreGraph; say: string }>;
  maps?(): Promise<SavedMap[]>;
  saveMap?(m: Omit<SavedMap, "key" | "savedAt">): Promise<SavedMap>;
  voice?(): Promise<{ stop(): Promise<string>; cancel(): void }>;
}

/* A store the player built: "store" is their own map of a real store
 * (it stays theirs until others agree), "dream" is made up and only
 * ever played as practice. */
export type SavedMap = { key: string; kind: "store" | "dream"; storeId?: string; name: string; graph: StoreGraph; savedAt?: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Character art for an item when the list gives none (a small subset
 * of the app's manifest, enough for the samples). */
const ART: [string[], string][] = [
  [["banana"], "banana.webp"], [["spinach", "lettuce", "kale", "vegetable", "tomato", "carrot"], "vegetable.webp"],
  [["berry", "berries", "blueberr"], "blueberry.webp"], [["raspberr"], "raspberry.webp"], [["mandarin", "orange"], "mandarin.webp"],
  [["apple", "fruit"], "fruit.webp"], [["bread", "sourdough", "bagel"], "bread.webp"], [["croissant", "muffin", "cake"], "bakery.webp"],
  [["hummus", "dip"], "hummus.webp"], [["milk"], "milk.webp"], [["egg"], "egg.webp"], [["cheese", "cheddar"], "cheese.webp"],
  [["yogurt", "butter", "cream"], "dairy.webp"], [["pizza"], "pizza.webp"], [["frozen", "ice cream"], "frozen.webp"],
  [["pasta", "penne", "spaghetti"], "pasta.webp"], [["olive oil", "oil"], "olive-oil.webp"], [["peanut butter"], "peanut-butter.webp"],
  [["almond", "nut"], "almond.webp"],
];
export function artFor(name: string): string {
  const n = name.toLowerCase();
  for (const [words, art] of ART) if (words.some(w => n.includes(w))) return art;
  return "pantry.webp";
}
export const ALL_STICKERS = ["banana.webp", "vegetable.webp", "blueberry.webp", "raspberry.webp", "mandarin.webp", "fruit.webp", "bread.webp", "bakery.webp", "hummus.webp", "milk.webp", "egg.webp", "cheese.webp", "dairy.webp", "pizza.webp", "frozen.webp", "pasta.webp", "olive-oil.webp", "peanut-butter.webp", "almond.webp", "pantry.webp"];

export function toItems(list: ShoppingList, graph?: StoreGraph): QuestItem[] {
  return list.items.map((it, i) => ({ key: `${i}-${slug(it.name)}`, name: it.name, art: it.art || artFor(it.name), section: sectionFor(it.name, graph) }));
}

/* Where items sit in the section picture: mapped stores know this. */
const SHELF: Record<string, { hint: string; shelf: [number, number] }> = {
  bananas: { hint: "Front table, left side", shelf: [24, 66] },
  "baby spinach": { hint: "Cold wall, middle shelf", shelf: [74, 50] },
  blueberries: { hint: "Berry case, top shelf", shelf: [60, 38] },
  sourdough: { hint: "Rack by the window", shelf: [30, 42] },
  hummus: { hint: "Dips case, top shelf", shelf: [70, 36] },
  "penne pasta": { hint: "Left side, low shelf", shelf: [22, 70] },
  "olive oil": { hint: "Right side, eye level", shelf: [76, 46] },
  milk: { hint: "Cooler 3, bottom shelf", shelf: [24, 72] },
  eggs: { hint: "Cooler 4, middle shelf", shelf: [56, 52] },
  cheddar: { hint: "Cooler 2, eye level", shelf: [80, 40] },
  "frozen pizza": { hint: "Door 7, top shelf", shelf: [44, 36] },
  "peanut butter": { hint: "Middle of the aisle, eye level", shelf: [50, 46] },
};

export const WEEKLY: ShoppingList = {
  id: "weekly", name: "Weekly groceries",
  items: ["Bananas", "Baby spinach", "Blueberries", "Sourdough", "Hummus", "Penne pasta", "Olive oil", "Milk", "Eggs", "Cheddar", "Frozen pizza"].map(name => ({ name })),
};
export const PRACTICE_LIST: ShoppingList = {
  id: "practice", name: "Practice list",
  items: ["Bananas", "Sourdough", "Penne pasta", "Olive oil", "Eggs", "Milk"].map(name => ({ name })),
};

type SampleStore = StoreSummary & { mapped?: string[]; shoppers?: number; graph?: StoreGraph };
const STORES: SampleStore[] = [
  { id: "tj-bellevue", name: "Trader Joe's", area: "Bellevue", kind: "mapped", miles: 0.4, seen: "Walked by 14 shoppers", shoppers: 14 },
  { id: "safeway-kirkland", name: "Safeway", area: "Kirkland", kind: "partial", miles: 1.2, seen: "4 of 8 sections seen", mapped: ["produce", "dairy", "frozen", "meat"] },
  { id: "qfc-redmond", name: "QFC", area: "Redmond", kind: "simulated", miles: 2.0, seen: "Nobody has mapped it yet" },
];
const MORE: SampleStore[] = [
  { id: "wf-seattle", name: "Whole Foods", area: "Seattle · Westlake", kind: "simulated", miles: 9.8, seen: "Nobody has mapped it yet" },
  { id: "safeway-bellevue", name: "Safeway", area: "Bellevue · Main St", kind: "partial", miles: 0.9, seen: "2 of 8 sections seen", mapped: ["produce", "dairy"] },
  { id: "costco-kirkland", name: "Costco", area: "Kirkland", kind: "simulated", miles: 1.6, seen: "Nobody has mapped it yet", graph: PRESETS.warehouse.graph },
  { id: "patel-redmond", name: "Patel Brothers", area: "Redmond", kind: "simulated", miles: 3.1, seen: "Nobody has mapped it yet", graph: PRESETS.indian.graph },
];
/* The practice store: a pretend store set up to teach every move,
 * real sections, one foggy aisle, a golden item. */
export const PRACTICE_STORE: SampleStore = { id: "practice", name: "Practice Market", area: "Tutorial", kind: "partial", mapped: ["produce", "bakery", "dairy"] };

export class SampleSource implements QuestSource {
  sent: FieldReport[] = [];
  async lists() { return [WEEKLY]; }
  async nearbyStores() { return STORES.map(({ mapped: _m, shoppers: _s, graph: _g, ...s }) => s); }
  async findStores(q: string) {
    const n = q.trim().toLowerCase();
    return [...STORES, ...MORE].filter(s => !n || `${s.name} ${s.area}`.toLowerCase().includes(n)).map(({ mapped: _m, shoppers: _s, graph: _g, ...s }) => s);
  }
  async open(storeId: string, list: ShoppingList) {
    const s = [...STORES, ...MORE, PRACTICE_STORE].find(x => x.id === storeId) || STORES[2];
    const base = toItems(list, s.graph);
    const layout = buildLayout({ id: s.id, name: s.name, area: s.area, kind: s.kind, items: base, mapped: s.mapped, shoppers: s.shoppers, graph: s.graph });
    // Spots only where the section is really mapped: a guess never names a shelf.
    const items = base.map(i => {
      const sp = SHELF[i.name.toLowerCase()];
      return layout.mapped.includes(i.section) && sp ? { ...i, spot: sp } : i;
    });
    return { layout, items };
  }
  async report(r: FieldReport) { this.sent.push(r); }
  /* The lab keeps built stores for the visit only. */
  private saved: SavedMap[] = [];
  async build(_a: Answers, base: StoreGraph) { return base; }
  async change(graph: StoreGraph) { return { graph, say: "In the app, Arya can change your store when you say what to move." }; }
  async maps() { return this.saved; }
  async saveMap(m: Omit<SavedMap, "key" | "savedAt">) {
    const key = m.kind === "store" ? `store:${m.storeId}` : `dream:${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const row = { ...m, key, savedAt: new Date().toISOString() };
    this.saved = [row, ...this.saved.filter(x => x.key !== key)];
    return row;
  }
}

/* Practice never reports anything: its finds are pretend. */
export class SilentSource extends SampleSource {
  async report() { /* practice: nothing leaves the game */ }
}
