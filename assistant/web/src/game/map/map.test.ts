import { describe, expect, it } from "vitest";
import { TEMPLATE, problems, type StoreGraph, type Zone } from "./graph";
import { solve } from "./solve";
import { knownZone, zoneFor } from "./classify";
import { PRESETS } from "./presets";
import { buildLayout } from "../core/template";
import { aryaOrder } from "../core/route";
import { entryOf, findPath, fixtures, floorOf, grid, isOpen, spots } from "../world/layout3d";
import type { QuestItem, Rect } from "../core/types";

/* The hand-placed template before the solver (spike, 2026-10-29). */
const OLD: Record<string, { rect: Rect; node: { x: number; y: number } }> = {
  produce: { rect: { x: 14, y: 64, w: 48, h: 270 }, node: { x: 38, y: 200 } },
  bakery: { rect: { x: 70, y: 14, w: 66, h: 42 }, node: { x: 103, y: 41 } },
  deli: { rect: { x: 142, y: 14, w: 66, h: 42 }, node: { x: 175, y: 41 } },
  meat: { rect: { x: 214, y: 14, w: 50, h: 42 }, node: { x: 239, y: 41 } },
  dairy: { rect: { x: 270, y: 14, w: 76, h: 42 }, node: { x: 308, y: 41 } },
  frozen: { rect: { x: 300, y: 66, w: 46, h: 250 }, node: { x: 323, y: 190 } },
  aisle1: { rect: { x: 108, y: 92, w: 34, h: 226 }, node: { x: 125, y: 260 } },
  aisle2: { rect: { x: 158, y: 92, w: 34, h: 226 }, node: { x: 175, y: 150 } },
  aisle3: { rect: { x: 208, y: 92, w: 34, h: 226 }, node: { x: 225, y: 260 } },
  aisle4: { rect: { x: 258, y: 92, w: 34, h: 226 }, node: { x: 275, y: 150 } },
};

const z = (id: string, kind: Zone["kind"], band: Zone["band"], index: number, extra: Partial<Zone> = {}): Zone => ({ id, kind, label: id, band, index, ...extra });
const WAREHOUSE: StoreGraph = {
  id: "warehouse", source: "dream", size: "l",
  zones: [
    z("produce", "produce", "back", 0, { size: "l" }), z("meat", "meat", "back", 1), z("dairy", "dairy", "back", 2, { size: "l" }),
    z("bakery", "bakery", "left", 0), z("frozen", "frozen", "right", 0), z("flowers", "produce", "front", 0),
    ...Array.from({ length: 8 }, (_, i) => z(`aisle${i + 1}`, "aisle", "centre", i)),
  ],
};
const CORNER: StoreGraph = {
  id: "corner", source: "mine", size: "s",
  zones: [z("drinks", "dairy", "left", 0, { categories: ["soda", "milk"] }), z("snacks", "aisle", "centre", 0, { categories: ["chips"] }), z("basics", "aisle", "centre", 1), z("hot", "deli", "back", 0)],
};
const INDIAN: StoreGraph = {
  id: "indian", source: "dream",
  zones: [
    z("produce", "produce", "left", 0), z("spices", "aisle", "left", 1, { label: "Spice wall", categories: ["masala", "turmeric", "cumin", "spice"] }),
    z("sweets", "bakery", "back", 0, { label: "Sweets", categories: ["ladoo", "barfi"] }), z("dairy", "dairy", "back", 1, { categories: ["paneer", "ghee", "milk"] }),
    z("rice", "aisle", "centre", 0, { label: "Rice & Atta", categories: ["basmati", "atta", "rice"] }), z("dal", "aisle", "centre", 1, { label: "Dal & Beans", categories: ["dal", "lentil", "chana"] }),
    z("frozen", "frozen", "right", 0, { categories: ["paratha", "samosa"] }),
  ],
};

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("solve", () => {
  it("rebuilds the hand-placed template from its graph", () => {
    const P = solve(TEMPLATE);
    expect([P.w, P.h]).toEqual([360, 440]);
    for (const s of P.sections) {
      const o = OLD[s.id];
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(s.rect[k] - o.rect[k])).toBeLessThanOrEqual(1);
      expect(Math.abs(s.node.x - o.node.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.node.y - o.node.y)).toBeLessThanOrEqual(1);
    }
    expect(P.racks.map(r => r.x)).toEqual([92, 142, 192, 242, 292]);
  });

  for (const g of [TEMPLATE, WAREHOUSE, CORNER, INDIAN, ...Object.values(PRESETS).map(p => p.graph).filter(g => g !== TEMPLATE)]) {
    it(`${g.id} (${g.source}): valid, deterministic, nothing overlaps on the same wall, every item reachable`, () => {
      expect(problems(g)).toEqual([]);
      expect(solve(g)).toEqual(solve(g));
      const P = solve(g);
      for (const a of P.sections) for (const b of P.sections)
        if (a !== b && a.band === b.band) expect(overlap(a.rect, b.rect)).toBe(false);
      for (const s of P.sections) {
        expect(s.rect.x).toBeGreaterThanOrEqual(0); expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(P.w);
        expect(s.rect.y).toBeGreaterThanOrEqual(0); expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(P.h);
      }
      // Two items per zone, each with an open standing spot the shopper can walk to from the doors.
      const items: QuestItem[] = g.zones.flatMap(zn => [0, 1].map(k => ({ key: `${zn.id}-${k}`, name: zn.id, art: "", section: zn.id })));
      const L = buildLayout({ id: g.id, name: g.id, area: "", kind: "mapped", items, graph: g });
      expect(L.sections.length).toBe(g.zones.length);
      const FL = floorOf(L), G = grid(fixtures(L), FL), S = spots(L, items, G), from = entryOf(FL);
      expect(S.length).toBe(items.length);
      for (const sp of S) {
        expect(isOpen(G, sp.stand)).toBe(true);
        const path = findPath(G, from, sp.stand);
        expect(path.length).toBeGreaterThan(0);
        const end = path[path.length - 1];
        expect(Math.hypot(end.x - sp.stand.x, end.z - sp.stand.z)).toBeLessThan(0.01);
      }
      // One walk covers every zone; cold cases come last.
      const order = aryaOrder(L, items);
      expect(new Set(order).size).toBe(g.zones.length);
      const cold = order.map(id => L.sections.find(s => s.id === id)!.kind).map(k => k === "dairy" || k === "frozen");
      expect(cold.indexOf(true) === -1 || cold.slice(cold.indexOf(true)).every(Boolean)).toBe(true);
    });
  }

  it("grows with the store: more aisles make a wider store, size makes it deeper", () => {
    expect(solve(WAREHOUSE).w).toBeGreaterThan(solve(TEMPLATE).w);
    expect(solve(WAREHOUSE).h).toBeGreaterThan(solve(TEMPLATE).h);
    expect(solve(CORNER).h).toBeLessThan(solve(TEMPLATE).h);
  });
});

describe("problems", () => {
  it("names what makes a graph unusable", () => {
    expect(problems({ id: "x", source: "mine", zones: [] })).toContain("no zones");
    const bad: StoreGraph = { id: "x", source: "mine", zones: [z("a", "aisle", "centre", 0), z("a", "aisle", "centre", 1), { ...z("B c", "aisle", "centre", 2) }, { ...z("d", "toys" as never, "roof" as never, 0) }] };
    const p = problems(bad).join("|");
    expect(p).toContain("duplicate id a");
    expect(p).toContain("bad id");
    expect(p).toContain("unknown kind");
    expect(p).toContain("unknown band");
  });
});

describe("classify", () => {
  it("files items by the store's own words, then by kind, then the first aisle", () => {
    expect(zoneFor("Peanut butter")).toBe("aisle3");
    expect(zoneFor("Bananas")).toBe("produce");
    expect(zoneFor("Garam masala", INDIAN)).toBe("spices");
    expect(zoneFor("Paneer", INDIAN)).toBe("dairy");
    expect(zoneFor("Bananas", INDIAN)).toBe("produce");          // template word, same kind
    expect(zoneFor("Frozen pizza", CORNER)).toBe("snacks");      // no frozen zone: first aisle
    expect(zoneFor("Cheddar", CORNER)).toBe("drinks");           // dairy kind
    expect(knownZone("Dish brush")).toBeNull();
  });
});
