import { describe, expect, it } from "vitest";
import { applyTrip, emptyProfile, levelOf, stageOf, streak, weekKey, bundleProgress, BUNDLES } from "./meta";
import { aryaOrder } from "./route";
import { ALL_STICKERS, PRACTICE_LIST, PRACTICE_STORE, SampleSource, WEEKLY, toItems } from "./source";
import { buildLayout, sectionFor, viewOf } from "./template";
import { SCORE, allHandled, currentStop, newTrip, reduce, tally, unmappedFinds, type Trip } from "./trip";

const src = new SampleSource();
const open = (store: string, list = WEEKLY) => src.open(store, list);

describe("template", () => {
  it("files items into sections by name", () => {
    expect(sectionFor("Bananas")).toBe("produce");
    expect(sectionFor("Frozen pizza")).toBe("frozen");
    expect(sectionFor("Olive oil")).toBe("aisle2");
    expect(sectionFor("Peanut butter")).toBe("aisle3");
    expect(sectionFor("Something odd")).toBe("aisle1");
  });
  it("a simulated store only guesses and never shows a spot", async () => {
    const { layout, items } = await open("qfc-redmond");
    expect(layout.mapped).toEqual([]);
    expect(items.every(i => !i.spot)).toBe(true);
    expect(viewOf(layout, "produce")).toBe("guess");
  });
  it("a partly mapped store shows fog where nobody has looked, and no spot there", async () => {
    const { layout, items } = await open("safeway-kirkland");
    expect(viewOf(layout, "produce")).toBe("real");
    expect(viewOf(layout, "aisle2")).toBe("fog");
    expect(viewOf(layout, "aisle2", new Set(["aisle2"]))).toBe("real");
    expect(items.filter(i => i.section === "aisle2").every(i => !i.spot)).toBe(true);
    expect(items.find(i => i.name === "Milk")!.spot).toBeTruthy();
  });
  it("only keeps the aisles the list needs", () => {
    const l = buildLayout({ id: "x", name: "x", area: "x", kind: "simulated", items: toItems(PRACTICE_LIST) });
    expect(l.sections.map(s => s.id)).not.toContain("aisle4");
    expect(l.sections.map(s => s.id)).toContain("aisle2");
  });
});

describe("route", () => {
  it("walks once and keeps cold food last", async () => {
    const { layout, items } = await open("tj-bellevue");
    const order = aryaOrder(layout, items);
    expect(order[0]).toBe("produce");
    expect(order.slice(-2)).toEqual(["dairy", "frozen"]);
  });
  it("walks up the left wall, along the back, the aisles, then cold cases", async () => {
    const { layout, items } = await open("tj-bellevue");
    const order = aryaOrder(layout, items);
    const pos = (id: string) => order.indexOf(id);
    const has = (id: string) => pos(id) >= 0;
    if (has("bakery") && has("meat")) expect(pos("bakery")).toBeLessThan(pos("meat"));
    const aisles = order.filter(id => id.startsWith("aisle"));
    expect(aisles).toEqual([...aisles].sort());
  });
});

async function practiceTrip(): Promise<Trip> {
  const { layout, items } = await src.open(PRACTICE_STORE.id, PRACTICE_LIST);
  const eggs = items.find(i => i.name === "Eggs")!.key;
  return newTrip(layout, items, { practice: true, golden: eggs });
}
const key = (t: Trip, name: string) => t.items.find(i => i.name === name)!.key;

describe("trip rules", () => {
  it("scores grabs, the golden item and a clean sweep", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "enter", section: "dairy" });
    t = reduce(t, { type: "grab", key: key(t, "Eggs") });
    expect(t.events[0]).toMatchObject({ t: "grab", golden: true, pts: SCORE.item * SCORE.golden, chain: 1 });
    t = reduce(t, { type: "grab", key: key(t, "Milk") });
    expect(t.events.find(e => e.t === "clear")).toMatchObject({ sweep: true, pts: SCORE.clear + SCORE.sweep });
    expect(t.points).toBe(20 + 10 + 30);
  });
  it("leaving a section half done costs the sweep, never the clear", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "enter", section: "dairy" });
    t = reduce(t, { type: "grab", key: key(t, "Milk") });
    t = reduce(t, { type: "enter", section: "produce" });
    t = reduce(t, { type: "enter", section: "dairy" });
    t = reduce(t, { type: "grab", key: key(t, "Eggs") });
    expect(t.events.find(e => e.t === "clear")).toMatchObject({ sweep: false, pts: SCORE.clear });
  });
  it("finding an item in fog clears the fog and pays the scout bonus", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "scout", key: key(t, "Penne pasta") });
    expect(t.scouted).toEqual(["aisle2"]);
    expect(t.events.some(e => e.t === "scout")).toBe(true);
    expect(t.points).toBe(SCORE.item + SCORE.scout);
  });
  it("a shelf report counts as progress and moves the route on", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "report", key: key(t, "Olive oil"), kind: "empty" });
    expect(t.points).toBe(SCORE.report);
    expect(t.reports).toHaveLength(1);
  });
  it("undo takes back the item and its clear bonus, nothing else", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "grab", key: key(t, "Bananas") });
    const after = t.points;
    expect(after).toBe(SCORE.item + SCORE.clear);
    t = reduce(t, { type: "ungrab", key: key(t, "Bananas") });
    expect(t.points).toBe(0);
    expect(t.cleared).toEqual([]);
  });
  it("the route moves on as sections finish; skipping keeps items on the list", async () => {
    let t = await practiceTrip();
    expect(currentStop(t)).toBe("produce");
    t = reduce(t, { type: "skipSection", section: "produce" });
    expect(currentStop(t)).toBe("bakery");
    expect(t.items.some(i => i.name === "Bananas")).toBe(true);
  });
  it("an item set aside comes back to the route", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "pass", key: key(t, "Bananas") });
    expect(currentStop(t)).toBe("bakery");
    t = reduce(t, { type: "unpass", key: key(t, "Bananas") });
    expect(currentStop(t)).toBe("produce");
  });
  it("adding an item slots its section into the route", async () => {
    let t = await practiceTrip();
    t = reduce(t, { type: "addItem", item: { key: "x-pb", name: "Peanut butter", art: "peanut-butter.webp", section: "aisle3" } });
    expect(t.order.indexOf("aisle3")).toBe(t.order.indexOf("aisle2") + 1);
    expect(t.layout.sections.some(s => s.id === "aisle3")).toBe(true);
  });
  it("the tally adds up to the points", async () => {
    let t = await practiceTrip();
    for (const name of ["Bananas", "Sourdough", "Eggs", "Milk"]) t = reduce(t, { type: "grab", key: key(t, name) });
    t = reduce(t, { type: "scout", key: key(t, "Penne pasta") });
    t = reduce(t, { type: "report", key: key(t, "Olive oil"), kind: "empty" });
    expect(allHandled(t)).toBe(true);
    expect(t.events.some(e => e.t === "allDone")).toBe(true);
    expect(tally(t).reduce((s, l) => s + l.pts, 0)).toBe(t.points);
  });
  it("the tally's cart count matches the trip: the golden item is one of them", async () => {
    let t = await practiceTrip();
    for (const it of t.items) t = reduce(t, { type: "grab", key: it.key });
    const cart = tally(t).filter(l => /in the cart/.test(l.label))[0];
    const n = Number(cart.label.split(" ")[0]);
    const golden = t.golden && t.got.includes(t.golden) ? 1 : 0;
    expect(n + golden).toBe(t.got.length);
    if (golden) expect(cart.label).toContain("other");
  });
  it("the golden item is never in fog", async () => {
    const { layout, items } = await open("safeway-kirkland");
    for (let seed = 0; seed < 20; seed++) {
      const g = newTrip(layout, items, { seed }).golden!;
      expect(viewOf(layout, items.find(i => i.key === g)!.section)).not.toBe("fog");
    }
  });
});

describe("progression", () => {
  const now = new Date(2026, 9, 29);
  it("practice changes nothing", async () => {
    let t = await practiceTrip();
    for (const i of t.items) t = reduce(t, { type: "grab", key: i.key });
    const p = emptyProfile();
    const r = applyTrip(p, t, now, ALL_STICKERS, 3);
    expect(r.profile).toBe(p);
    expect(r.rewards.practice).toBe(true);
    expect(r.rewards.mystery).toBeNull();
  });
  it("a real trip adds xp, stickers, the week and store growth", async () => {
    const { layout, items } = await open("safeway-kirkland");
    let t = newTrip(layout, items, { seed: 1 });
    for (const i of t.items) t = reduce(t, { type: i.section === "aisle2" ? "scout" : "grab", key: i.key });
    const r = applyTrip(emptyProfile(), t, now, ALL_STICKERS, 3);
    expect(r.profile.xp).toBe(t.points);
    expect(r.rewards.newStickers.length).toBeGreaterThan(3);
    expect(r.rewards.newShiny).toContain("pasta.webp");
    expect(r.profile.weeks).toEqual([weekKey(now)]);
    expect(r.rewards.stage.after.pct).toBeGreaterThan(r.rewards.stage.before.pct);
    expect(r.rewards.mystery && !r.rewards.newStickers.includes(r.rewards.mystery)).toBeTruthy();
    expect(r.profile.bundles).toEqual(expect.arrayContaining(["breakfast", "pasta-night"]));
  });
  it("levels grow by 100 xp per level", () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelOf(100).level).toBe(2);
    expect(levelOf(299).level).toBe(2);
    expect(levelOf(300).level).toBe(3);
  });
  it("the weekly streak rests on a missed week instead of breaking", () => {
    const wk = (d: number) => weekKey(new Date(2026, 9, 29 - d * 7));
    expect(streak([wk(0), wk(1), wk(2)], now).weeks).toBe(3);
    const s = streak([wk(0), wk(2), wk(3)], now);
    expect(s.weeks).toBe(3);
    expect(s.freezesLeft).toBe(1);
    expect(streak([wk(1)], now)).toMatchObject({ weeks: 1, thisWeek: false });
    expect(streak([wk(0), wk(4)], now).weeks).toBe(1);
  });
  it("store growth goes from fog to legendary", () => {
    expect(stageOf(undefined).name).toBe("Fog");
    expect(stageOf({ mapped: ["a", "b"], trips: 1, total: 4 }).name).toBe("Sketch");
    expect(stageOf({ mapped: ["a", "b", "c", "d"], trips: 3, total: 4 }).name).toBe("Legendary");
  });
  it("bundles fill from things people really buy", () => {
    expect(bundleProgress(["eggs", "sourdough"], BUNDLES[0])).toEqual({ met: [true, true, false], done: false });
  });
});

describe("substitutes", () => {
  it("a substitute scores like a grab and keeps its name until put back", async () => {
    let t = await practiceTrip();
    const milk = key(t, "Milk");
    t = reduce(t, { type: "grab", key: milk, instead: "  Oat milk " });
    expect(t.subs[milk]).toBe("Oat milk");
    expect(t.events[0]).toMatchObject({ t: "grab", key: milk, instead: "Oat milk" });
    expect(t.got).toContain(milk);
    t = reduce(t, { type: "ungrab", key: milk });
    expect(t.subs[milk]).toBeUndefined();
    t = reduce(t, { type: "grab", key: milk, instead: "   " });
    expect(t.subs[milk]).toBeUndefined();
  });
});

describe("shelf photos (fog nudge)", () => {
  it("lists each section a find was made in that Arya had not located, once", async () => {
    const { layout, items } = await new SampleSource().open("safeway-kirkland", { id: "l", name: "L", items: ["Milk", "Penne pasta", "Spaghetti", "Olive oil"].map(name => ({ name })) });
    let t = newTrip(layout, items, { seed: 1 });
    for (const i of items) t = reduce(t, { type: i.section === "dairy" ? "grab" : "scout", key: i.key });
    const finds = unmappedFinds(t);
    expect(finds.map(f => f.section)).not.toContain("dairy");
    expect(new Set(finds.map(f => f.section)).size).toBe(finds.length);
    expect(finds[0].item).toBe("Penne pasta");
  });
  it("remembers a snapped section once", async () => {
    const { layout, items } = await new SampleSource().open("qfc-redmond", { id: "l", name: "L", items: [{ name: "Milk" }] });
    let t = newTrip(layout, items, { seed: 1 });
    t = reduce(t, { type: "snapped", section: "dairy" });
    expect(reduce(t, { type: "snapped", section: "dairy" })).toBe(t);
    expect(t.snapped).toEqual(["dairy"]);
  });
});
