/* The typical grocery store. A simulated store is this template with
 * only the sections a list needs; a partly mapped store marks the
 * sections Arya has seen. Coordinates are on a 360 x 440 plan: doors
 * bottom-left, checkout bottom-centre, fresh food around the walls,
 * numbered aisles in the middle (the usual US supermarket plan). */
import type { QuestItem, Section, StoreLayout, MapKind } from "./types";

export const PLAN = { w: 360, h: 440 };
export const ENTRY = { x: 48, y: 424 };
export const CHECKOUT = { x: 225, y: 396 };

export const SECTIONS: Section[] = [
  { id: "produce", name: "Produce", short: "Produce", kind: "produce", rect: { x: 14, y: 64, w: 48, h: 270 }, node: { x: 38, y: 200 }, color: 0xddefd3, ink: 0x2f5a1f, typical: "Usually by the doors" },
  { id: "bakery", name: "Bakery", short: "Bakery", kind: "bakery", rect: { x: 70, y: 14, w: 66, h: 42 }, node: { x: 103, y: 41 }, color: 0xf6e3c8, ink: 0x6b4413, typical: "Usually in a front or back corner" },
  { id: "deli", name: "Deli & Dips", short: "Deli", kind: "deli", rect: { x: 142, y: 14, w: 66, h: 42 }, node: { x: 175, y: 41 }, color: 0xf7dcd3, ink: 0x7a2e19, typical: "Usually along the back wall" },
  { id: "meat", name: "Meat & Fish", short: "Meat", kind: "meat", rect: { x: 214, y: 14, w: 50, h: 42 }, node: { x: 239, y: 41 }, color: 0xf3d6dc, ink: 0x7a1f35, typical: "Usually along the back wall" },
  { id: "dairy", name: "Dairy & Eggs", short: "Dairy", kind: "dairy", rect: { x: 270, y: 14, w: 76, h: 42 }, node: { x: 308, y: 41 }, color: 0xdce9f7, ink: 0x1e4a7a, typical: "Usually a back corner, far from the doors" },
  { id: "frozen", name: "Frozen", short: "Frozen", kind: "frozen", rect: { x: 300, y: 66, w: 46, h: 250 }, node: { x: 323, y: 190 }, color: 0xddf1f4, ink: 0x145560, typical: "Usually a long aisle near the checkout" },
  { id: "aisle1", name: "Aisle 1 · Snacks & Drinks", short: "Aisle 1", kind: "aisle", rect: { x: 108, y: 92, w: 34, h: 226 }, node: { x: 125, y: 260 }, color: 0xece5f6, ink: 0x4b2f7a, typical: "Usually a centre aisle" },
  { id: "aisle2", name: "Aisle 2 · Pasta & Oils", short: "Aisle 2", kind: "aisle", rect: { x: 158, y: 92, w: 34, h: 226 }, node: { x: 175, y: 150 }, color: 0xece5f6, ink: 0x4b2f7a, typical: "Usually a centre aisle" },
  { id: "aisle3", name: "Aisle 3 · Breakfast & Spreads", short: "Aisle 3", kind: "aisle", rect: { x: 208, y: 92, w: 34, h: 226 }, node: { x: 225, y: 260 }, color: 0xece5f6, ink: 0x4b2f7a, typical: "Usually a centre aisle" },
  { id: "aisle4", name: "Aisle 4 · Household", short: "Aisle 4", kind: "aisle", rect: { x: 258, y: 92, w: 34, h: 226 }, node: { x: 275, y: 150 }, color: 0xece5f6, ink: 0x4b2f7a, typical: "Usually the last centre aisle" },
];
export const RACKS = [92, 142, 192, 242, 292].map(x => ({ x, y: 92, w: 16, h: 226 }));
export const sectionById = (id: string) => SECTIONS.find(s => s.id === id);

/* Which section an item lives in, from its name. Deterministic word
 * rules ($0, no model). Unknown items go to Aisle 1, the catch-all. */
const RULES: [string, string[]][] = [
  ["frozen", ["frozen", "ice cream", "pizza", "popsicle", "peas frozen"]],
  ["produce", ["banana", "apple", "spinach", "lettuce", "tomato", "onion", "potato", "avocado", "berries", "berry", "grape", "lemon", "lime", "orange", "mandarin", "carrot", "pepper", "cucumber", "herb", "cilantro", "kale", "broccoli", "garlic", "ginger", "fruit", "vegetable", "salad"]],
  ["bakery", ["bread", "sourdough", "bagel", "baguette", "croissant", "muffin", "bun", "tortilla", "cake", "pita"]],
  ["deli", ["hummus", "dip", "salsa", "deli", "prepared", "sandwich", "olives"]],
  ["meat", ["chicken", "beef", "pork", "salmon", "fish", "turkey", "shrimp", "sausage", "bacon", "tofu"]],
  ["dairy", ["milk", "egg", "cheese", "cheddar", "yogurt", "butter", "cream", "kefir"]],
  ["aisle2", ["pasta", "penne", "spaghetti", "rice", "oil", "vinegar", "sauce", "beans", "soup", "flour", "sugar", "spice", "can "]],
  ["aisle3", ["cereal", "oat", "granola", "peanut butter", "jam", "honey", "coffee", "tea", "almond", "nut", "pancake", "syrup"]],
  ["aisle4", ["paper", "towel", "soap", "detergent", "tissue", "foil", "trash", "sponge", "toilet"]],
  ["aisle1", ["chips", "cracker", "cookie", "soda", "juice", "water", "snack", "chocolate", "popcorn"]],
];
// Longest phrase first, so "peanut butter" beats "butter".
const PHRASES = RULES.flatMap(([id, words]) => words.map(w => [w, id] as const)).sort((a, b) => b[0].length - a[0].length);
export function sectionFor(name: string): string {
  const n = " " + name.toLowerCase() + " ";
  return PHRASES.find(([w]) => n.includes(w))?.[1] ?? "aisle1";
}

/* A store layout from the template. `mapped` lists the sections Arya
 * has seen (all of them for a mapped store, none for a guess). */
export function buildLayout(o: { id: string; name: string; area: string; kind: MapKind; items: QuestItem[]; mapped?: string[]; shoppers?: number }): StoreLayout {
  const need = new Set(o.items.map(i => i.section));
  const sections = SECTIONS.filter(s => s.kind !== "aisle" || need.has(s.id));
  const mapped = o.kind === "mapped" ? sections.map(s => s.id)
    : o.kind === "partial" ? (o.mapped || []).filter(id => sections.some(s => s.id === id))
      : [];
  return { id: o.id, name: o.name, area: o.area, kind: o.kind, sections, mapped, entry: ENTRY, checkout: CHECKOUT, shoppers: o.shoppers };
}

/* What a section looks like to the player: real, fog (partly mapped,
 * not seen yet) or a labelled guess (simulated or practice). A fog
 * section the player has scouted this trip counts as real. */
export type SectionView = "real" | "fog" | "guess";
export function viewOf(layout: StoreLayout, sectionId: string, scouted: ReadonlySet<string> = new Set()): SectionView {
  if (layout.mapped.includes(sectionId) || scouted.has(sectionId)) return "real";
  return layout.kind === "partial" ? "fog" : layout.kind === "mapped" ? "real" : "guess";
}
