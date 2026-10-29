/* Which zone of a store an item belongs in, from its name. Words the
 * store's own zones list win (longest phrase first, so "peanut butter"
 * beats "butter"); otherwise the template's word for the item picks a
 * zone of the same kind; otherwise the first centre aisle. Deterministic
 * and free; the model classifier (later) only fills what this misses. */
import { TEMPLATE, inBand, type StoreGraph } from "./graph";

const phrases = (g: StoreGraph) =>
  g.zones.flatMap(z => (z.categories || []).map(w => [w.toLowerCase(), z.id] as const)).sort((a, b) => b[0].length - a[0].length);
const cache = new WeakMap<StoreGraph, (readonly [string, string])[]>();

function match(g: StoreGraph, name: string): string | null {
  let ps = cache.get(g); if (!ps) { ps = phrases(g); cache.set(g, ps); }
  const n = " " + name.toLowerCase() + " ";
  return ps.find(([w]) => n.includes(w))?.[1] ?? null;
}

/* null when nothing in the store or the template knows the item. */
export function knownZone(name: string, g: StoreGraph = TEMPLATE): string | null {
  const own = match(g, name);
  if (own) return own;
  if (g === TEMPLATE) return null;
  const t = match(TEMPLATE, name);
  const kind = t && TEMPLATE.zones.find(z => z.id === t)!.kind;
  if (!kind) return null;
  if (kind === "aisle") return g.zones.find(z => z.id === t)?.id ?? null;
  return g.zones.find(z => z.kind === kind)?.id ?? null;
}

export function zoneFor(name: string, g: StoreGraph = TEMPLATE): string {
  return knownZone(name, g) ?? (inBand(g, "centre")[0] || g.zones[0]).id;
}
