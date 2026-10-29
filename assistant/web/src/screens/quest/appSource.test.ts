import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; url: string; body?: any }[] = [];
const replies: Record<string, unknown> = {};
vi.mock("../../lib/api", () => ({
  get: vi.fn(async (url: string) => { calls.push({ method: "GET", url }); const k = Object.keys(replies).find(p => url.startsWith(p)); if (!k) throw new Error("404 " + url); return replies[k]; }),
  post: vi.fn(async (url: string, body: any) => { calls.push({ method: "POST", url, body }); const k = Object.keys(replies).find(p => url.startsWith(p)); return k ? replies[k] : {}; }),
  put: vi.fn(async (url: string, body: any) => { calls.push({ method: "PUT", url, body }); return { key: `${body.kind}:${body.storeId || "x"}`, ...body }; }),
}));
vi.mock("../../lib/characters", () => ({ loadCharacters: async () => {}, charFor: () => "" }));

import { AppSource, kindFor, shelfHint, mappedSections, sectionOfLabel } from "./appSource";
import { buildLayout, sectionFor } from "../../game/core/template";
import { findPath, fixtures, floorOf, grid, isOpen, pathLength, spots } from "../../game/world/layout3d";

beforeEach(() => { calls.length = 0; for (const k of Object.keys(replies)) delete replies[k]; });

describe("store map labels", () => {
  it("reads common labels as template sections", () => {
    expect(sectionOfLabel("Aisle 3")).toBe("aisle3");
    expect(sectionOfLabel("Aisle 12")).toBeNull();
    expect(sectionOfLabel("Produce wall")).toBe("produce");
    expect(sectionOfLabel("Seafood counter")).toBe("meat");
    expect(sectionOfLabel("Milk & eggs")).toBe("dairy");
    expect(sectionOfLabel("Greeting cards")).toBeNull();
  });
  it("names a shelf once", () => {
    expect(shelfHint("Rice & Olives Shelf")).toBe("Near the Rice & Olives shelf");
    expect(shelfHint("Milk")).toBe("Near the Milk shelf");
  });
  it("counts only fresh sightings, never stale ones", () => {
    const segs = [{ label: "Produce", status: "mapped" as const }, { label: "Frozen", status: "stale" as const }, { label: "Bakery", status: "aging" as const }];
    expect(mappedSections(segs).sort()).toEqual(["bakery", "produce"]);
  });
  it("names the store kind from what the trip needs", () => {
    expect(kindFor([], ["produce"])).toBe("simulated");
    expect(kindFor(["produce", "dairy"], ["produce"])).toBe("mapped");
    expect(kindFor(["produce"], ["produce", "dairy"])).toBe("partial");
  });
});

describe("AppSource", () => {
  it("offers Everything and each named list with open items", async () => {
    replies["/api/quest/plan"] = { list: [{ name: "Milk", list: "l1" }, { name: "Bread", list: null }] };
    replies["/api/lists"] = { lists: [{ id: "l1", name: "Costco" }, { id: "l2", name: "Empty" }] };
    const ls = await new AppSource().lists();
    expect(ls.map(l => [l.id, l.items.length])).toEqual([["all", 2], ["l1", 1]]);
  });

  it("a real trip is a hunt session: grabs check, misses report, finish closes", async () => {
    replies["/api/stores/mine"] = { stores: [{ id: "s1", name: "Safeway", city: "Seattle" }] };
    replies["/api/storemap"] = { segments: [{ label: "Dairy", status: "mapped" }] };
    replies["/api/quest/sessions/q1/state"] = { id: "q1", store: "Safeway", state: "finished", items: [], mode: "quest" };
    replies["/api/quest/sessions"] = { id: "q1", store: "Safeway", state: "not_started", mode: "quest", items: [{ name: "Milk", shelf_label: "Milk" }, { name: "Chips" }] };
    const src = new AppSource();
    const [st] = await src.nearbyStores();
    expect(st.kind).toBe("partial");
    const { layout, items } = await src.open("s1", { id: "all", name: "Everything", items: [{ name: "Milk" }, { name: "Chips" }] });
    expect(layout.kind).toBe("partial");
    expect(items.find(i => i.name === "Milk")?.spot?.hint).toBe("Near the Milk shelf");
    expect(items.find(i => i.name === "Chips")?.spot).toBeUndefined(); // fogged section: no hint passed as fact
    const create = calls.find(c => c.url === "/api/quest/sessions");
    expect(create?.body).toMatchObject({ store_id: "s1", store: "Safeway", mode: "quest" });

    src.progress({ kind: "grab", item: "Milk" });
    await src.report({ kind: "empty", item: "Chips", section: "aisle1", store: "s1" } as any);
    await src.finish();
    expect(calls.some(c => c.url === "/api/quest/sessions/q1/check" && c.body.checked === true)).toBe(true);
    expect(calls.find(c => c.url.endsWith("/report-missing"))?.body).toEqual({ item: "Chips", kind: "empty_shelf" });
    expect(calls.some(c => c.url === "/api/quest/sessions/q1/state" && c.body.state === "finished")).toBe(true);
    expect(src.session()?.state).toBe("finished");
  });
});

describe("AppSource zones", () => {
  it("asks Arya only about items the words do not know, and uses its answer", async () => {
    replies["/api/stores/mine"] = { stores: [{ id: "s1", name: "Safeway" }] };
    replies["/api/storemap"] = { segments: [] };
    replies["/api/quest/zones"] = { zones: { "Dish brush": "aisle4" } };
    replies["/api/quest/sessions"] = { id: "q2", store: "Safeway", state: "not_started", mode: "quest", items: [] };
    const src = new AppSource();
    await src.nearbyStores();
    const { items } = await src.open("s1", { id: "all", name: "Everything", items: [{ name: "Milk" }, { name: "Dish brush" }] });
    const ask = calls.find(c => c.url === "/api/quest/zones");
    expect(ask?.body.items).toEqual(["Dish brush"]);
    expect(ask?.body.graph).toBe("template");
    expect(items.find(i => i.name === "Dish brush")?.section).toBe("aisle4");
    expect(items.find(i => i.name === "Milk")?.section).toBe("dairy");
  });
});

describe("AppSource Build", () => {
  const MINE = {
    id: "mine:s1", source: "mine" as const, size: "s" as const,
    zones: [
      { id: "cheese", kind: "dairy" as const, band: "back" as const, index: 0, label: "Cheese wall", categories: ["cheese", "brie"] },
      { id: "snacks", kind: "aisle" as const, band: "centre" as const, index: 0, label: "Aisle 1 · Snacks", categories: ["chips"] },
    ],
  };
  it("a saved My map is the store's shape on the next quest there", async () => {
    replies["/api/stores/mine"] = { stores: [{ id: "s1", name: "Safeway" }] };
    replies["/api/storemap"] = { segments: [] };
    replies["/api/quest/maps"] = { maps: [{ key: "store:s1", kind: "store", storeId: "s1", name: "Safeway", graph: MINE }] };
    replies["/api/quest/sessions"] = { id: "q3", store: "Safeway", state: "not_started", mode: "quest", items: [] };
    const src = new AppSource();
    const [st] = await src.nearbyStores();
    expect(st.seen).toBe("Your map");
    expect(calls.some(c => c.url.startsWith("/api/storemap"))).toBe(false);
    const { layout, items } = await src.open("s1", { id: "all", name: "Everything", items: [{ name: "Brie" }, { name: "Chips" }] });
    expect(layout.area).toBe("Your map");
    expect(layout.sections.map(s => s.id).sort()).toEqual(["cheese", "snacks"]);
    expect(items.map(i => i.section)).toEqual(["cheese", "snacks"]);
  });
  it("builds, changes and saves through the API", async () => {
    replies["/api/quest/build/change"] = { graph: MINE, say: "Moved it." };
    replies["/api/quest/build"] = { graph: MINE, say: "" };
    replies["/api/quest/maps"] = { maps: [] };
    const src = new AppSource();
    expect(await src.build({ type: "corner", look: "farm", focus: [] }, MINE)).toEqual(MINE);
    expect((await src.change(MINE, "move it")).say).toBe("Moved it.");
    await src.saveMap({ kind: "store", storeId: "s1", name: "Safeway", graph: MINE });
    expect(calls.find(c => c.method === "PUT")?.url).toBe("/api/quest/maps");
    expect((await src.maps()).map(m => m.key)).toEqual(["store:s1"]);
  });
});

describe("3D store walk", () => {
  const L0 = buildLayout({ id: "t", name: "T", area: "", kind: "mapped", items: [], mapped: [] });
  const F = fixtures(L0), g = grid(F, floorOf(L0));
  it("finds a walk from the doors to the back wall around the racks", () => {
    const from = { x: 9, z: 21 }, to = { x: 8.5, z: 1.6 };
    const pts = findPath(g, from, to);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(isOpen(g, p)).toBe(true);
    expect(pathLength(from, pts)).toBeGreaterThan(Math.hypot(0.5, 19.4) - 0.01);
  });
  it("gives every item its own standing spot on open floor", () => {
    const items = ["Milk", "Yogurt", "Chips", "Apples", "Ice cream"].map((name, i) => ({ key: "k" + i, name, art: "", section: sectionFor(name) }));
    const layout = buildLayout({ id: "t", name: "T", area: "", kind: "mapped", items, mapped: [] });
    const sp = spots(layout, items, g);
    expect(sp.map(s => s.key).sort()).toEqual(items.map(i => i.key).sort());
    for (const s of sp) expect(isOpen(g, s.stand)).toBe(true);
    expect(new Set(sp.map(s => `${s.at.x},${s.at.z}`)).size).toBe(sp.length);
  });
});
