/* One model of a store: a graph of zones placed by band and order,
 * never by tiles. Everything you see (the plan, the 3D fixtures, the
 * walk grid, where each item waits) is derived from it by solve() and
 * the world code, so a template store, a store a shopper drew, a
 * community map and a dream store all render the same way.
 * Plain TypeScript: no React, DOM or engine. */
import type { Band, SectionKind } from "../core/types";

export type { Band };
export type ZoneKind = SectionKind;
export type ZoneSize = "s" | "m" | "l";

export type Zone = {
  id: string;            // "aisle2", "dairy", "spices"
  kind: ZoneKind;        // decides fixtures, colour and the cold-last rule
  label: string;         // "Aisle 2 · Pasta & Oils"
  short?: string;        // sign text, "Aisle 2" (defaults to the label before " · ")
  band: Band;
  index: number;         // order along the band, 0 = nearest the doors (left, right, front) or leftmost (back, centre)
  size?: ZoneSize;       // relative only; exact tiles never matter
  categories?: string[]; // words that file an item here ("pasta", "olive oil")
};

export type StoreGraph = {
  id: string;
  source: "template" | "community" | "mine" | "dream";
  size?: ZoneSize;       // overall depth of the store
  zones: Zone[];
};

export const BANDS: Band[] = ["left", "back", "right", "centre", "front"];
export const KINDS: ZoneKind[] = ["produce", "bakery", "deli", "meat", "dairy", "frozen", "aisle"];

/* The usual US supermarket: fresh food around the walls, four centre
 * aisles, cold cases last. This is the store every unmapped store
 * starts from, and the regression fixture for the solver. */
export const TEMPLATE: StoreGraph = {
  id: "template",
  source: "template",
  size: "m",
  zones: [
    { id: "produce", kind: "produce", label: "Produce", band: "left", index: 0, categories: ["banana", "apple", "spinach", "lettuce", "tomato", "onion", "potato", "avocado", "berries", "berry", "grape", "lemon", "lime", "orange", "mandarin", "carrot", "pepper", "cucumber", "herb", "cilantro", "kale", "broccoli", "garlic", "ginger", "fruit", "vegetable", "salad"] },
    { id: "bakery", kind: "bakery", label: "Bakery", band: "back", index: 0, categories: ["bread", "sourdough", "bagel", "baguette", "croissant", "muffin", "bun", "tortilla", "cake", "pita"] },
    { id: "deli", kind: "deli", label: "Deli & Dips", short: "Deli", band: "back", index: 1, categories: ["hummus", "dip", "salsa", "deli", "prepared", "sandwich", "olives"] },
    { id: "meat", kind: "meat", label: "Meat & Fish", short: "Meat", band: "back", index: 2, size: "s", categories: ["chicken", "beef", "pork", "salmon", "fish", "turkey", "shrimp", "sausage", "bacon", "tofu"] },
    { id: "dairy", kind: "dairy", label: "Dairy & Eggs", short: "Dairy", band: "back", index: 3, size: "l", categories: ["milk", "egg", "cheese", "cheddar", "yogurt", "butter", "cream", "kefir"] },
    { id: "frozen", kind: "frozen", label: "Frozen", band: "right", index: 0, categories: ["frozen", "ice cream", "pizza", "popsicle", "peas frozen"] },
    { id: "aisle1", kind: "aisle", label: "Aisle 1 · Snacks & Drinks", band: "centre", index: 0, categories: ["chips", "cracker", "cookie", "soda", "juice", "water", "snack", "chocolate", "popcorn"] },
    { id: "aisle2", kind: "aisle", label: "Aisle 2 · Pasta & Oils", band: "centre", index: 1, categories: ["pasta", "penne", "spaghetti", "rice", "oil", "vinegar", "sauce", "beans", "soup", "flour", "sugar", "spice", "can "] },
    { id: "aisle3", kind: "aisle", label: "Aisle 3 · Breakfast & Spreads", band: "centre", index: 2, categories: ["cereal", "oat", "granola", "peanut butter", "jam", "honey", "coffee", "tea", "almond", "nut", "pancake", "syrup"] },
    { id: "aisle4", kind: "aisle", label: "Aisle 4 · Household", band: "centre", index: 3, categories: ["paper", "towel", "soap", "detergent", "tissue", "foil", "trash", "sponge", "toilet"] },
  ],
};

/* What is wrong with a graph, if anything (for model output and saved
 * maps). An empty list means it can be solved and walked. */
export function problems(g: StoreGraph): string[] {
  const out: string[] = [];
  if (!g.zones.length) out.push("no zones");
  if (g.zones.length > 24) out.push("more than 24 zones");
  const ids = new Set<string>();
  for (const z of g.zones) {
    if (!z.id || !/^[a-z0-9-]{1,32}$/.test(z.id)) out.push(`bad id ${JSON.stringify(z.id)}`);
    if (ids.has(z.id)) out.push(`duplicate id ${z.id}`);
    ids.add(z.id);
    if (!KINDS.includes(z.kind)) out.push(`${z.id}: unknown kind ${z.kind}`);
    if (!BANDS.includes(z.band)) out.push(`${z.id}: unknown band ${z.band}`);
    if (!z.label || z.label.length > 48) out.push(`${z.id}: label missing or too long`);
    if (z.size && !["s", "m", "l"].includes(z.size)) out.push(`${z.id}: bad size`);
  }
  const per = (b: Band) => g.zones.filter(z => z.band === b).length;
  if (per("centre") > 10) out.push("more than 10 centre aisles");
  if (per("back") > 7) out.push("more than 7 zones on the back wall");
  if (per("left") > 4 || per("right") > 4) out.push("more than 4 zones on a side wall");
  if (per("front") > 3) out.push("more than 3 zones by the doors");
  return out;
}

/* Zones of one band in walking order (index, then id for ties). */
export const inBand = (g: StoreGraph, b: Band) => g.zones.filter(z => z.band === b).sort((a, c) => a.index - c.index || a.id.localeCompare(c.id));
