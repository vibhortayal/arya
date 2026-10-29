/* The route: which sections to visit, in which order. Deterministic
 * ($0). Arya's order walks the store once: fresh food along the left
 * wall and the back, the centre aisles in a snake, then the cold
 * cases last so they stay cold. The player can move, skip and add. */
import type { Pt, QuestItem, StoreLayout } from "./types";

const WALK_ORDER = ["produce", "bakery", "deli", "meat", "aisle1", "aisle2", "aisle3", "aisle4", "dairy", "frozen"];

export function aryaOrder(layout: StoreLayout, items: QuestItem[]): string[] {
  const need = new Set(items.map(i => i.section));
  const known = WALK_ORDER.filter(id => need.has(id) && layout.sections.some(s => s.id === id));
  // Sections the walk order does not name keep their list order, before the cold cases.
  const extra = [...need].filter(id => !known.includes(id));
  const cold: string[] = known.filter(id => id === "dairy" || id === "frozen");
  return [...known.filter(id => !cold.includes(id)), ...extra, ...cold];
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

/* The walking path between two stops on the plan. Paths keep to the
 * front and back walkways so they never cross a shelf. */
export function leg(a: Pt, b: Pt): Pt[] {
  if (a.y < 60 && b.y < 60) return [b];
  const wy = (a.y + b.y) / 2 < 220 ? 74 : 340;
  return [{ x: a.x, y: wy }, { x: b.x, y: wy }, b];
}

/* The whole path: doors -> each stop -> checkout. `upTo` is the index
 * of the current stop; the result splits into walked and ahead. */
export function routePath(layout: StoreLayout, order: string[], upTo: number): { walked: Pt[]; ahead: Pt[] } {
  const nodes = order.map(id => layout.sections.find(s => s.id === id)!.node);
  const walked: Pt[] = [layout.entry];
  let ahead: Pt[] = [];
  let prev = layout.entry;
  nodes.forEach((n, i) => {
    const pts = leg(prev, n);
    if (i < upTo) walked.push(...pts);
    else { if (!ahead.length) ahead = [prev]; ahead.push(...pts); }
    prev = n;
  });
  const end = leg(prev, layout.checkout);
  if (ahead.length) ahead.push(...end); else walked.push(...end);
  return { walked, ahead };
}

export const pathLength = (pts: Pt[]) => pts.slice(1).reduce((d, p, i) => d + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

/* The point a fraction t (0..1) along a path. */
export function pointAt(pts: Pt[], t: number): Pt {
  const total = pathLength(pts);
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (want <= d || i === pts.length - 1) { const f = d ? Math.min(1, want / d) : 1; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
    want -= d;
  }
  return pts[pts.length - 1];
}
