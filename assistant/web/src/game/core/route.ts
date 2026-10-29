/* The route: which sections to visit, in which order. Deterministic
 * ($0). Arya's order walks any store once, the way the shelves sit: up
 * the left wall from the doors, along the back, the centre aisles in a
 * snake, down the right wall, the tables by the doors, and the cold
 * cases (dairy, frozen) last so they stay cold. The player can move,
 * skip and add. */
import type { QuestItem, Section, StoreLayout } from "./types";

const BAND_ORDER = { left: 0, back: 1, centre: 2, right: 3, front: 4 } as const;

/* Where a section falls on one walk of the store. */
function walkKey(s: Section): [number, number] {
  const b = BAND_ORDER[s.band];
  if (s.band === "left") return [b, -s.node.y];          // doors are at the bottom: walk up
  if (s.band === "right") return [b, s.node.y];          // back to front
  return [b, s.node.x];                                  // back, centre, front: left to right
}
const cold = (s: Section) => s.kind === "dairy" || s.kind === "frozen";

export function aryaOrder(layout: StoreLayout, items: QuestItem[]): string[] {
  const need = new Set(items.map(i => i.section));
  const secs = layout.sections.filter(s => need.has(s.id));
  const by = (a: Section, b: Section) => { const [x, y] = walkKey(a), [u, v] = walkKey(b); return x - u || y - v; };
  const warm = secs.filter(s => !cold(s)).sort(by), cool = secs.filter(cold).sort(by);
  // Sections the layout does not have keep their list order, before the cold cases.
  const extra = [...need].filter(id => !secs.some(s => s.id === id));
  return [...warm.map(s => s.id), ...extra, ...cool.map(s => s.id)];
}

export function move(order: string[], id: string, by: -1 | 1): string[] {
  const i = order.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const out = order.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* One sentence on why the order is what it is (or what changed). */
export function routeNote(order: string[]): string {
  const live = order;
  if (!live.includes("frozen")) return "Arya walks the store once, walls first, then the aisles.";
  return live[live.length - 1] === "frozen"
    ? "Frozen is last so it stays cold."
    : "Heads up: Frozen is not last, so it will be out of the freezer longer.";
}
