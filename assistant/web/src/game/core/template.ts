/* The typical grocery store. A simulated store is this template with
 * only the sections a list needs; a partly mapped store marks the
 * sections Arya has seen. The store itself is map/graph.ts TEMPLATE,
 * laid out by map/solve.ts (a 360 x 440 plan: doors bottom-left,
 * fresh food around the walls, numbered aisles in the middle). */
import type { QuestItem, Section, StoreLayout, MapKind } from "./types";
import { TEMPLATE, type StoreGraph } from "../map/graph";
import { solve } from "../map/solve";
import { zoneFor } from "../map/classify";

const T = solve(TEMPLATE);
export const PLAN = { w: T.w, h: T.h };
export const ENTRY = T.entry;
export const CHECKOUT = T.checkout;
export const SECTIONS: Section[] = T.sections;
export const RACKS = T.racks;
export const sectionById = (id: string) => SECTIONS.find(s => s.id === id);

/* Which section an item lives in, from its name (map/classify.ts).
 * Unknown items go to the first centre aisle. */
export function sectionFor(name: string, graph: StoreGraph = TEMPLATE): string {
  return zoneFor(name, graph);
}

/* A store layout from the template. `mapped` lists the sections Arya
 * has seen (all of them for a mapped store, none for a guess). */
export function buildLayout(o: { id: string; name: string; area: string; kind: MapKind; items: QuestItem[]; mapped?: string[]; shoppers?: number; graph?: StoreGraph; all?: boolean; typicalOf?: string }): StoreLayout {
  const P = o.graph ? solve(o.graph) : T;
  const need = new Set(o.items.map(i => i.section));
  // Centre aisles the list does not need stay as bare racks; wall sections always show.
  const sections = P.sections.filter(s => o.all || s.kind !== "aisle" || s.band !== "centre" || need.has(s.id));
  // A mapped store is real where it was located; a section nobody located is a labelled guess, not fog.
  const mapped = o.kind === "mapped" && !o.mapped ? sections.map(s => s.id)
    : o.kind !== "simulated" ? (o.mapped || []).filter(id => sections.some(s => s.id === id))
      : [];
  return { id: o.id, name: o.name, area: o.area, kind: o.kind, sections, mapped, entry: P.entry, checkout: P.checkout, shoppers: o.shoppers, plan: { w: P.w, h: P.h }, racks: P.racks, ...(o.typicalOf && o.kind === "simulated" ? { typicalOf: o.typicalOf } : {}), ...(o.graph?.look ? { look: o.graph.look } : {}) };
}

/* What a section looks like to the player: real, fog (partly mapped,
 * not seen yet) or a labelled guess (simulated or practice, or the odd
 * section of a mapped store nobody has located). A fog
 * section the player has scouted this trip counts as real. */
export type SectionView = "real" | "fog" | "guess";
export function viewOf(layout: StoreLayout, sectionId: string, scouted: ReadonlySet<string> = new Set()): SectionView {
  if (layout.mapped.includes(sectionId) || scouted.has(sectionId)) return "real";
  return layout.kind === "partial" ? "fog" : "guess";
}
