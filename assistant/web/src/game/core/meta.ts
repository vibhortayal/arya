/* What carries from trip to trip: level, the sticker album, the weekly
 * streak, bundles and how "built" each store is. Pure functions over a
 * plain profile object; the caller decides where it is stored.
 * A practice trip changes nothing here (tested). */
import { itemsIn, type Trip } from "./trip";

export type StoreGrowth = { mapped: string[]; trips: number; total: number };

export type Profile = {
  xp: number;
  stickers: string[];               // character files found at least once (the album)
  shiny: string[];                  // stickers earned by mapping (fog cleared there)
  weeks: string[];                  // ISO weeks with a real trip ("2026-W44")
  trips: number;
  stores: Record<string, StoreGrowth>;
  found: string[];                  // item names ever got (lower case), for bundles
  bundles: string[];                // bundles completed
  reports: number;
};

export const emptyProfile = (): Profile => ({ xp: 0, stickers: [], shiny: [], weeks: [], trips: 0, stores: {}, found: [], bundles: [], reports: 0 });

/* Level n needs 100 * n xp to finish (L1 0-99, L2 100-299, ...). */
export function levelOf(xp: number) {
  let level = 1, floor = 0;
  while (xp >= floor + 100 * level) { floor += 100 * level; level++; }
  return { level, into: xp - floor, need: 100 * level };
}

/* ISO week key for a date. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}
function prevWeek(key: string): string {
  const [y, w] = key.split("-W").map(Number);
  // Monday of ISO week w, minus 7 days.
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000 + (w - 1) * 7 * 86400000);
  return weekKey(new Date(mon.getTime() - 7 * 86400000 + 12 * 3600000));
}

/* The weekly streak. Grocery runs are weekly, so weeks, not days.
 * Freezes are built in (two, Duolingo found slack does not add
 * skipping): a missed week uses one and the streak "rests". It never
 * shows a broken streak, and the lifetime count never goes down. */
export function streak(weeks: string[], now: Date) {
  const have = new Set(weeks);
  let cur = weekKey(now);
  if (!have.has(cur)) cur = prevWeek(cur); // this week is still open
  // A gap uses a freeze only when an older played week sits behind it.
  let n = 0, used = 0, pending = 0;
  for (let i = 0; i < 520; i++) {
    if (have.has(cur)) { n++; used += pending; pending = 0; }
    else if (n > 0 && used + pending < 2) pending++;
    else break;
    cur = prevWeek(cur);
  }
  return { weeks: n, freezesLeft: 2 - used, lifetime: have.size, thisWeek: have.has(weekKey(now)) };
}

/* Store growth: how much of a store the community has seen. */
export type Stage = { name: "Fog" | "Blueprint" | "Sketch" | "Full colour" | "Legendary"; pct: number };
export function stageOf(g: StoreGrowth | undefined): Stage {
  const pct = g && g.total ? Math.round((g.mapped.length / g.total) * 100) : 0;
  if (pct >= 100 && (g?.trips || 0) >= 3) return { name: "Legendary", pct };
  if (pct >= 75) return { name: "Full colour", pct };
  if (pct >= 50) return { name: "Sketch", pct };
  if (pct >= 25) return { name: "Blueprint", pct };
  return { name: "Fog", pct };
}

/* Bundles (Stardew Valley): sets of things people really buy. Each
 * slot is met by any item whose name has one of the words. */
export const BUNDLES = [
  { id: "breakfast", name: "Breakfast bundle", slots: [["egg"], ["bread", "sourdough", "bagel"], ["banana", "berry", "berries", "apple", "orange", "mandarin"]], reward: "A sunrise banner for your store" },
  { id: "pasta-night", name: "Pasta night bundle", slots: [["pasta", "penne", "spaghetti"], ["oil"], ["cheese", "cheddar", "parmesan"], ["spinach", "tomato", "basil"]], reward: "Fairy lights over the aisles" },
];
export function bundleProgress(found: string[], b: (typeof BUNDLES)[number]) {
  const met = b.slots.map(words => found.some(n => words.some(w => n.includes(w))));
  return { met, done: met.every(Boolean) };
}

export type Rewards = {
  practice: boolean;
  xp: number;
  levelUp: number | null;
  newStickers: string[];
  newShiny: string[];
  mystery: string | null;          // the cosmetic sticker reveal at checkout
  streak: ReturnType<typeof streak>;
  stage: { before: Stage; after: Stage };
  bundlesDone: string[];
};

/* Folds a finished trip into the profile. Practice returns the same
 * profile untouched. `allStickers` is the character set the mystery
 * reveal draws from; `seed` makes the draw repeatable. */
export function applyTrip(p: Profile, trip: Trip, now: Date, allStickers: string[], seed = 0): { profile: Profile; rewards: Rewards } {
  const before = stageOf(p.stores[trip.layout.id]);
  if (trip.practice) {
    return { profile: p, rewards: { practice: true, xp: 0, levelUp: null, newStickers: [], newShiny: [], mystery: null, streak: streak(p.weeks, now), stage: { before, after: before }, bundlesDone: [] } };
  }
  const got = trip.items.filter(i => trip.got.includes(i.key));
  const arts = [...new Set(got.map(i => i.art))];
  const newStickers = arts.filter(a => !p.stickers.includes(a));
  const scoutArts = [...new Set(got.filter(i => trip.scouted.includes(i.section)).map(i => i.art))];
  const newShiny = scoutArts.filter(a => !p.shiny.includes(a));
  const missing = allStickers.filter(s => !p.stickers.includes(s) && !arts.includes(s));
  const mystery = got.length ? (missing.length ? missing[Math.abs(seed) % missing.length] : null) : null;
  const xp = trip.points;
  const lvBefore = levelOf(p.xp).level, lvAfter = levelOf(p.xp + xp).level;
  const week = weekKey(now);
  const g0 = p.stores[trip.layout.id] || { mapped: [], trips: 0, total: trip.layout.sections.length };
  const mappedNow = [...new Set([...g0.mapped, ...trip.layout.mapped, ...trip.scouted])];
  const g1: StoreGrowth = { mapped: mappedNow, trips: g0.trips + 1, total: Math.max(g0.total, trip.layout.sections.length) };
  const found = [...new Set([...p.found, ...got.map(i => i.name.toLowerCase())])];
  const bundlesDone = BUNDLES.filter(b => !p.bundles.includes(b.id) && bundleProgress(found, b).done).map(b => b.id);
  const profile: Profile = {
    xp: p.xp + xp,
    stickers: [...p.stickers, ...newStickers, ...(mystery ? [mystery] : [])],
    shiny: [...p.shiny, ...newShiny],
    weeks: p.weeks.includes(week) ? p.weeks : [...p.weeks, week],
    trips: p.trips + 1,
    stores: { ...p.stores, [trip.layout.id]: g1 },
    found,
    bundles: [...p.bundles, ...bundlesDone],
    reports: p.reports + trip.reports.length,
  };
  return {
    profile,
    rewards: { practice: false, xp, levelUp: lvAfter > lvBefore ? lvAfter : null, newStickers, newShiny, mystery, streak: streak(profile.weeks, now), stage: { before, after: stageOf(g1) }, bundlesDone },
  };
}

/* Sections of a trip's store the player has helped map, for the finish. */
export const sectionsTaught = (trip: Trip) => trip.scouted.filter(s => itemsIn(trip, s).length);
