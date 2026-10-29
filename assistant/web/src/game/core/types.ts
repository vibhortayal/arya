/* Quest game: the shapes every part of the game shares. The core
 * (this folder) is plain TypeScript with no React, DOM or engine, so
 * the rules can be tested alone and reused by any front end. */

/* How well Arya knows a store. It decides what the game may claim. */
export type MapKind =
  | "mapped"     // shoppers walked it: sections and spots are real
  | "partial"    // some sections are real, the rest are fog
  | "simulated"  // nobody mapped it: a typical layout, every spot a guess
  | "practice";  // pretend store, sample list, nothing is saved

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type SectionKind = "produce" | "bakery" | "deli" | "meat" | "dairy" | "frozen" | "aisle";
/* Where along the store a section sits (see map/graph.ts). The doors are front-left. */
export type Band = "left" | "back" | "right" | "centre" | "front";

export type Section = {
  id: string;
  name: string;      // "Aisle 2 · Pasta & Oils"
  short: string;     // "Aisle 2"
  kind: SectionKind;
  rect: Rect;        // on the 360 x 440 store plan
  node: Pt;          // where the route stops
  color: number;     // floor tint (0xRRGGBB)
  ink: number;       // label colour
  typical: string;   // "Usually by the doors" — the only hint a guess may give
  band: Band;
};

export type StoreLayout = {
  id: string;
  name: string;      // "Safeway"
  area: string;      // "Kirkland"
  kind: MapKind;
  sections: Section[];
  /* Sections Arya has really seen. Empty for simulated and practice. */
  mapped: string[];
  entry: Pt;
  checkout: Pt;
  shoppers?: number; // people who walked it (mapped stores)
  /* A chain's layout played as a guess at a location nobody mapped ("Trader Joe's"). */
  typicalOf?: string;
  /* The plan's size and its shelving racks, from the store's graph (map/solve.ts). */
  plan: { w: number; h: number };
  racks: Rect[];
  look?: "market" | "modern" | "farm" | "neon";
};

/* A spot the game may show: a real one in a mapped section, or a "usually" one from a chain's typical layout. */
export type Spot = { hint: string; shelf?: [number, number] }; // shelf = % position in the scene

export type QuestItem = {
  key: string;
  name: string;
  art: string;          // character file, e.g. "banana.webp"
  section: string;      // section id
  spot?: Spot;
};

export type StoreSummary = { id: string; name: string; area: string; kind: MapKind; miles?: number; seen?: string };

export type ShoppingList = { id: string; name: string; items: { name: string; art?: string }[] };
