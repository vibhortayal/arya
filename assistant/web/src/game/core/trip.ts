/* One trip through a store: the game's rules as a pure reducer.
 * No clocks, no lives, nothing to lose: every action only adds.
 * The UI dispatches actions and plays the events the reducer emits
 * (the juice); it never computes score itself. */
import { aryaOrder, move } from "./route";
import { sectionById, viewOf } from "./template";
import type { QuestItem, StoreLayout } from "./types";

export const SCORE = { item: 10, golden: 2, clear: 20, sweep: 10, scout: 25, report: 15 } as const;

export type ReportKind = "empty" | "elsewhere";

export type GameEvent =
  | { t: "grab"; key: string; pts: number; golden: boolean; chain: number; firstInSection: boolean }
  | { t: "ungrab"; key: string; pts: number }
  | { t: "scout"; section: string; key: string; pts: number }
  | { t: "report"; key: string; kind: ReportKind; pts: number }
  | { t: "clear"; section: string; pts: number; sweep: boolean }
  | { t: "allDone" };

export type Trip = {
  layout: StoreLayout;
  items: QuestItem[];
  order: string[];
  skipped: string[];             // sections the player skipped (items stay on the list)
  got: string[];                 // item keys, in grab order
  passed: string[];              // items set aside for now
  reports: { key: string; kind: ReportKind }[];
  scouted: string[];             // fog sections the player put on the map this trip
  cleared: string[];             // sections finished with at least one item got
  clearPts: Record<string, number>; // the bonus each clear paid (an undo takes it back)
  golden: string | null;         // one item per trip counts double
  points: number;
  here: string | null;           // the section the player is in
  chain: number;                 // grabs in a row in this section (a count, never a clock)
  leftEarly: string[];           // sections left with items still to get (no sweep bonus)
  events: GameEvent[];
  practice: boolean;
};

export type Action =
  | { type: "enter"; section: string }
  | { type: "grab"; key: string }
  | { type: "ungrab"; key: string }
  | { type: "scout"; key: string }
  | { type: "report"; key: string; kind: ReportKind }
  | { type: "pass"; key: string }
  | { type: "unpass"; key: string }
  | { type: "skipSection"; section: string }
  | { type: "unskipSection"; section: string }
  | { type: "move"; section: string; by: -1 | 1 }
  | { type: "resetOrder" }
  | { type: "addItem"; item: QuestItem };

/* The golden item: picked from the list by a seed, so a trip can be
 * replayed and tested. Never an item in a fog section (it must be findable). */
export function pickGolden(layout: StoreLayout, items: QuestItem[], seed: number): string | null {
  const pool = items.filter(i => viewOf(layout, i.section) !== "fog");
  if (!pool.length) return null;
  return pool[Math.abs(Math.floor(seed)) % pool.length].key;
}

export function newTrip(layout: StoreLayout, items: QuestItem[], o: { seed?: number; practice?: boolean; golden?: string | null } = {}): Trip {
  return {
    layout, items, order: aryaOrder(layout, items), skipped: [], got: [], passed: [], reports: [], scouted: [], cleared: [], clearPts: {},
    golden: o.golden !== undefined ? o.golden : pickGolden(layout, items, o.seed ?? 0),
    points: 0, here: null, chain: 0, leftEarly: [], events: [], practice: !!o.practice,
  };
}

/* ---- reading a trip ---- */
export const itemsIn = (trip: Trip, section: string) => trip.items.filter(i => i.section === section);
const handled = (trip: Trip, key: string) =>
  trip.got.includes(key) || trip.passed.includes(key) || trip.reports.some(r => r.key === key);
export const isHandled = handled;
export const leftIn = (trip: Trip, section: string) => itemsIn(trip, section).filter(i => !handled(trip, i.key));
/* The stops on the route: sections in order that hold list items. */
export const stops = (trip: Trip) => trip.order.filter(id => itemsIn(trip, id).length > 0);
export const liveStops = (trip: Trip) => stops(trip).filter(id => !trip.skipped.includes(id));
export const currentStop = (trip: Trip) => liveStops(trip).find(id => leftIn(trip, id).length > 0) ?? null;
export const nextItem = (trip: Trip, section: string) => leftIn(trip, section)[0] ?? null;
export const progress = (trip: Trip) => ({ done: trip.got.length, total: trip.items.length });
export const allHandled = (trip: Trip) => trip.items.every(i => handled(trip, i.key));
export const sectionView = (trip: Trip, section: string) => viewOf(trip.layout, section, new Set(trip.scouted));

/* ---- the reducer ---- */
export function reduce(trip: Trip, a: Action): Trip {
  const t: Trip = { ...trip, events: [] };
  switch (a.type) {
    case "enter": {
      if (t.here && t.here !== a.section && leftIn(t, t.here).length && !t.leftEarly.includes(t.here) && itemsIn(t, t.here).some(i => handled(t, i.key)))
        t.leftEarly = [...t.leftEarly, t.here];
      if (t.here !== a.section) t.chain = 0;
      t.here = a.section;
      return t;
    }
    case "grab":
    case "scout": {
      const item = t.items.find(i => i.key === a.key);
      if (!item || handled(t, a.key)) return trip;
      if (t.here !== item.section) { t.chain = 0; t.here = item.section; }
      const golden = a.key === t.golden;
      const firstInSection = !itemsIn(t, item.section).some(i => handled(t, i.key));
      let pts = SCORE.item * (golden ? SCORE.golden : 1);
      t.got = [...t.got, a.key];
      t.chain = t.chain + 1;
      if (a.type === "scout" && sectionView(trip, item.section) === "fog") {
        t.scouted = [...t.scouted, item.section];
        t.events.push({ t: "scout", section: item.section, key: a.key, pts: SCORE.scout });
        pts += SCORE.scout;
      }
      t.events.unshift({ t: "grab", key: a.key, pts: SCORE.item * (golden ? SCORE.golden : 1), golden, chain: t.chain, firstInSection });
      t.points += pts;
      return afterHandle(t, item.section);
    }
    case "report": {
      const item = t.items.find(i => i.key === a.key);
      if (!item || handled(t, a.key)) return trip;
      t.reports = [...t.reports, { key: a.key, kind: a.kind }];
      t.points += SCORE.report;
      t.events.push({ t: "report", key: a.key, kind: a.kind, pts: SCORE.report });
      return afterHandle(t, item.section);
    }
    case "pass": {
      const item = t.items.find(i => i.key === a.key);
      if (!item || handled(t, a.key)) return trip;
      t.passed = [...t.passed, a.key];
      t.chain = 0;
      return afterHandle(t, item.section);
    }
    case "unpass": return t.passed.includes(a.key) ? { ...t, passed: t.passed.filter(k => k !== a.key) } : trip;
    case "ungrab": {
      if (!t.got.includes(a.key)) return trip;
      const item = t.items.find(i => i.key === a.key)!;
      const pts = SCORE.item * (a.key === t.golden ? SCORE.golden : 1);
      t.got = t.got.filter(k => k !== a.key);
      t.points = Math.max(0, t.points - pts);
      t.chain = Math.max(0, t.chain - 1);
      if (t.cleared.includes(item.section)) {
        t.points = Math.max(0, t.points - (t.clearPts[item.section] || 0));
        t.cleared = t.cleared.filter(s => s !== item.section);
        const { [item.section]: _gone, ...rest } = t.clearPts; t.clearPts = rest;
      }
      t.events.push({ t: "ungrab", key: a.key, pts });
      return t;
    }
    case "skipSection": return t.skipped.includes(a.section) ? trip : { ...t, skipped: [...t.skipped, a.section] };
    case "unskipSection": return { ...t, skipped: t.skipped.filter(s => s !== a.section) };
    case "move": return { ...t, order: move(t.order, a.section, a.by) };
    case "resetOrder": return { ...t, order: aryaOrder(t.layout, t.items), skipped: [] };
    case "addItem": {
      if (t.items.some(i => i.key === a.item.key)) return trip;
      const items = [...t.items, a.item];
      // A new aisle joins the plan; on a partly mapped store it starts as fog.
      const add = !t.layout.sections.some(s => s.id === a.item.section) && sectionById(a.item.section);
      const layout = add ? { ...t.layout, sections: [...t.layout.sections, add] } : t.layout;
      const order = t.order.includes(a.item.section) ? t.order : insertBySuggestion({ ...t, layout }, a.item.section, items);
      return { ...t, items, order, layout };
    }
  }
}

function insertBySuggestion(t: Trip, section: string, items: QuestItem[]) {
  const suggested = aryaOrder(t.layout, items);
  const at = suggested.indexOf(section);
  const before = suggested.slice(0, at).filter(s => t.order.includes(s)).pop();
  const out = t.order.slice();
  out.splice(before ? out.indexOf(before) + 1 : 0, 0, section);
  return out;
}

/* After an item is handled: a finished section pays the clear bonus
 * once, plus a sweep bonus when the player got all of it in one visit. */
function afterHandle(t: Trip, section: string): Trip {
  if (!leftIn(t, section).length && !t.cleared.includes(section) && itemsIn(t, section).some(i => t.got.includes(i.key))) {
    const sweep = isSweep(t, section);
    const pts = SCORE.clear + (sweep ? SCORE.sweep : 0);
    t.cleared = [...t.cleared, section];
    t.clearPts = { ...t.clearPts, [section]: pts };
    t.points += pts;
    t.events.push({ t: "clear", section, pts, sweep });
  }
  if (allHandled(t)) t.events.push({ t: "allDone" });
  return t;
}

/* A clean sweep: every item of a section (two or more) got in one visit. */
const isSweep = (t: Trip, section: string) =>
  !t.leftEarly.includes(section) && itemsIn(t, section).length > 1 && itemsIn(t, section).every(i => t.got.includes(i.key));

/* The finale tally, line by line (the Sugar Crush moment). Each line
 * is something the player really did. */
export function tally(t: Trip): { label: string; pts: number }[] {
  const lines: { label: string; pts: number }[] = [];
  const goldenGot = t.golden && t.got.includes(t.golden);
  const plain = t.got.length - (goldenGot ? 1 : 0);
  if (plain) lines.push({ label: `${plain} item${plain === 1 ? "" : "s"} in the cart`, pts: plain * SCORE.item });
  if (goldenGot) lines.push({ label: "Golden item", pts: SCORE.item * SCORE.golden });
  const clears = t.cleared;
  if (clears.length) lines.push({ label: `${clears.length} section${clears.length === 1 ? "" : "s"} cleared`, pts: clears.length * SCORE.clear });
  const sweeps = clears.filter(s => (t.clearPts[s] || 0) > SCORE.clear).length;
  if (sweeps) lines.push({ label: `${sweeps} clean sweep${sweeps === 1 ? "" : "s"}`, pts: sweeps * SCORE.sweep });
  if (t.scouted.length) lines.push({ label: `Fog cleared in ${t.scouted.length} section${t.scouted.length === 1 ? "" : "s"}`, pts: t.scouted.length * SCORE.scout });
  if (t.reports.length) lines.push({ label: `${t.reports.length} shelf report${t.reports.length === 1 ? "" : "s"}`, pts: t.reports.length * SCORE.report });
  return lines;
}
