/* Build: a few answers -> a whole store. This is the deterministic
 * version (free, instant, always works); Arya's model pass can rename
 * zones and fill in a cuisine on top of it, and when that fails this
 * store stands. Never a blank slate: every answer set gives a store
 * you can walk. */
import { problems, type StoreGraph, type Zone } from "./graph";
import { PRESETS, type StoreType } from "./presets";

export type Look = "market" | "modern" | "farm" | "neon";
export const LOOKS: { id: Look; name: string; blurb: string }[] = [
  { id: "market", name: "Cozy market", blurb: "Warm wood and sunny tiles" },
  { id: "modern", name: "Bright & modern", blurb: "White, clean, glowing cases" },
  { id: "farm", name: "Farm stand", blurb: "Barn red, crates, fresh greens" },
  { id: "neon", name: "Neon arcade", blurb: "Night-time colours, very loud" },
];

/* Things a builder can make big. Each grows a zone of that kind, or adds one. */
export type Focus = "fresh" | "bakery" | "snacks" | "frozen" | "drinks" | "household";
export const FOCUS: { id: Focus; name: string }[] = [
  { id: "fresh", name: "Fruit & veg" }, { id: "bakery", name: "Bakery" }, { id: "snacks", name: "Snacks" },
  { id: "frozen", name: "Frozen" }, { id: "drinks", name: "Drinks" }, { id: "household", name: "Household" },
];

export type Answers = {
  type: StoreType | "cuisine" | "single";
  cuisine?: string;      // "Turkish" (type cuisine) or "cheese" (type single)
  look: Look;
  focus: Focus[];
  extra?: string;        // "a big olive bar by the doors", said or typed; Arya's pass reads it
  name?: string;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "zone";
const cap = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^./, c => c.toUpperCase());

/* The preset a type starts from: a cuisine starts from the Indian
 * grocer's shape (fresh, spice wall, dry goods aisles), one kind of
 * food from the corner store's (small, a few aisles). */
export function baseFor(a: Answers): StoreGraph {
  if (a.type === "cuisine") return PRESETS.indian.graph;
  if (a.type === "single") return PRESETS.corner.graph;
  return PRESETS[a.type].graph;
}

const FOCUS_ZONE: Record<Focus, Pick<Zone, "kind" | "band" | "label" | "categories"> & { match: (z: Zone) => boolean }> = {
  fresh: { kind: "produce", band: "left", label: "Fruit & Veg", categories: ["fruit", "vegetable"], match: z => z.kind === "produce" },
  bakery: { kind: "bakery", band: "back", label: "Bakery", categories: ["bread", "cake"], match: z => z.kind === "bakery" },
  snacks: { kind: "aisle", band: "centre", label: "Snacks", categories: ["chips", "cookie", "snack", "chocolate"], match: z => /snack|sweet/i.test(z.label) },
  frozen: { kind: "frozen", band: "right", label: "Frozen", categories: ["frozen", "ice cream"], match: z => z.kind === "frozen" },
  drinks: { kind: "aisle", band: "centre", label: "Drinks", categories: ["water", "soda", "juice", "coffee", "tea"], match: z => /drink/i.test(z.label) },
  household: { kind: "aisle", band: "centre", label: "Household", categories: ["paper", "soap", "detergent", "towel"], match: z => /household|cleaning|paper|home/i.test(z.label) },
};

export function fromAnswers(a: Answers): StoreGraph {
  const base = baseFor(a);
  let zones: Zone[] = base.zones.map(z => ({ ...z, categories: [...(z.categories || [])] }));
  const what = (a.cuisine || "").trim();
  if (a.type === "cuisine" && what) {
    // The spice wall and dry goods aisles get the cuisine's name; Arya's pass fills in real items.
    zones = zones.map(z => z.id === "spices" ? { ...z, label: `${cap(what)} pantry` } : z.id === "sweets" ? { ...z, label: `${cap(what)} sweets` } : z);
  }
  if (a.type === "single" && what) {
    // One kind of food: it takes the whole back wall and the first aisle.
    zones = zones.map(z => z.id === "cold" ? { ...z, label: cap(what), short: cap(what).slice(0, 14), categories: [what.toLowerCase()], size: "l" } : z);
  }
  for (const f of a.focus) {
    const spec = FOCUS_ZONE[f], hit = zones.find(spec.match);
    if (hit) { hit.size = "l"; continue; }
    const id = (() => { let id = slug(spec.label), n = 2; while (zones.some(z => z.id === id)) id = `${slug(spec.label)}-${n++}`; return id; })();
    const index = zones.filter(z => z.band === spec.band).length;
    const zone: Zone = { id, kind: spec.kind, band: spec.band, index, label: spec.band === "centre" ? `Aisle ${index + 1} · ${spec.label}` : spec.label, categories: spec.categories, size: "l" };
    zones.push(zone);
  }
  // Number the centre aisles in order, keeping their topics.
  zones.filter(z => z.band === "centre").sort((x, y) => x.index - y.index).forEach((z, i) => {
    const topic = z.label.includes(" · ") ? z.label.split(" · ").slice(1).join(" · ") : z.label;
    z.label = `Aisle ${i + 1} · ${topic}`; z.short = `Aisle ${i + 1}`; z.index = i;
  });
  const g: StoreGraph = { id: "build", source: "dream", size: base.size, look: a.look, name: a.name?.trim() || undefined, zones };
  return problems(g).length ? { ...base, id: "build", source: "dream", look: a.look } : g;
}
