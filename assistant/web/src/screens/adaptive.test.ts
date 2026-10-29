import { autoMode, filterLists, markOpened, readOpened, recentLists, viewMode, type ListsMode } from "./lists/adaptive";
import { capLists, capRows } from "./Today";
import { filterStores, type MyStore } from "./StoresMine";

/* The adaptive layout (#156): the Lists home's mode with hysteresis
 * and the Cards | List override, search, Recent, and Today's caps. */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

/* Walk the count from `from` to `to` one list at a time, carrying the
 * last mode as the screen does; return the mode at each count. */
function walk(from: number, to: number, start: ListsMode | null): ListsMode[] {
  const out: ListsMode[] = [];
  let m = start;
  const step = from <= to ? 1 : -1;
  for (let n = from; n !== to + step; n += step) { m = autoMode(n, m); out.push(m); }
  return out;
}

describe("lists mode", () => {
  test("thresholds from a fresh device", () => {
    for (const n of [0, 1, 2, 3]) expect(autoMode(n, null)).toBe("large");
    for (const n of [4, 5, 10, 11]) expect(autoMode(n, null)).toBe("tiles");
    for (const n of [12, 20, 30]) expect(autoMode(n, null)).toBe("dense");
  });
  test("denser at 4 and 12 on the way up", () => {
    expect(walk(1, 13, null)).toEqual([
      "large", "large", "large", "tiles", "tiles", "tiles", "tiles", "tiles", "tiles", "tiles", "tiles", "dense", "dense"]);
  });
  test("back only at 10 and 3 on the way down", () => {
    // 13..1 from dense: 11 stays dense, 10 goes to tiles, 3 to large.
    expect(walk(13, 1, "dense")).toEqual([
      "dense", "dense", "dense", "tiles", "tiles", "tiles", "tiles", "tiles", "tiles", "tiles", "large", "large", "large"]);
  });
  test("one list more or less never flips the view at 11", () => {
    expect(autoMode(11, "dense")).toBe("dense");
    expect(autoMode(12, autoMode(11, "dense"))).toBe("dense");
    expect(autoMode(11, "tiles")).toBe("tiles");
    expect(autoMode(11, "large")).toBe("tiles");
  });
  test("the switch overrides from 4 lists, not below", () => {
    expect(viewMode(30, "dense", "cards")).toBe("tiles");
    expect(viewMode(5, "tiles", "list")).toBe("dense");
    expect(viewMode(4, "tiles", null)).toBe("tiles");
    expect(viewMode(3, "large", "list")).toBe("large");
    expect(viewMode(1, "large", "cards")).toBe("large");
    expect(viewMode(12, "dense", null)).toBe("dense");
  });
});

describe("search", () => {
  const lists = [
    { id: "a", name: "Trader Joe's", stores: ["Trader Joe's"] },
    { id: "b", name: "Weekly", stores: ["Costco Wholesale", "Safeway"] },
    { id: "c", name: "BBQ Sunday", stores: [] },
    { id: "d", name: "Party" },
  ];
  test("by list name or store, any case", () => {
    expect(filterLists(lists, "joe").map(l => l.id)).toEqual(["a"]);
    expect(filterLists(lists, "COSTCO").map(l => l.id)).toEqual(["b"]);
    expect(filterLists(lists, "  bbq ").map(l => l.id)).toEqual(["c"]);
    expect(filterLists(lists, "s").map(l => l.id)).toEqual(["a", "b", "c"]);
    expect(filterLists(lists, "zzz")).toEqual([]);
    expect(filterLists(lists, "")).toBe(lists);
  });
  test("my stores by name, street, city or ZIP", () => {
    const s = (id: string, name: string, city: string, zip: string): MyStore => ({ id, name, street: "1 Main St", city, state: "CA", zip });
    const stores = [s("1", "Costco", "Mountain View", "94040"), s("2", "Safeway", "Palo Alto", "94301")];
    expect(filterStores(stores, "palo").map(x => x.id)).toEqual(["2"]);
    expect(filterStores(stores, "9404").map(x => x.id)).toEqual(["1"]);
    expect(filterStores(stores, "MAIN").map(x => x.id)).toEqual(["1", "2"]);
  });
});

describe("recent", () => {
  const lists = ["a", "b", "c", "d", "e", "f", "g"].map(id => ({ id }));
  test("newest first, five at most, list order for the rest", () => {
    expect(recentLists(lists, { e: 5, b: 9 }).map(l => l.id)).toEqual(["b", "e", "a", "c", "d"]);
  });
  test("nothing stored: the list order", () => {
    expect(recentLists(lists, {}).map(l => l.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("opening a list stamps it on this device", () => {
    localStorage.clear();
    markOpened("l-1", 100);
    markOpened("else", 200);
    markOpened("l-2", 300);
    expect(readOpened()).toEqual({ "l-1": 100, "l-2": 300 });
  });
});

describe("today caps", () => {
  test("three rows or fewer: unchanged", () => {
    expect(capRows([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capRows([], false)).toEqual({ shown: [], more: 0 });
  });
  test("more than three: three, then See N more; open shows all", () => {
    expect(capRows([1, 2, 3, 4, 5], false)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capRows([1, 2, 3, 4, 5], true)).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
  });
  test("four lists or fewer: every tile; more: four and See all", () => {
    expect(capLists([1, 2, 3, 4, 5], 4)).toEqual({ shown: [1, 2, 3, 4, 5], seeAll: false }); // 4 lists + Everything else
    expect(capLists(Array.from({ length: 31 }, (_, k) => k), 30)).toEqual({ shown: [0, 1, 2, 3], seeAll: true });
    expect(capLists([1, 2, 3, 4, 5], 5)).toEqual({ shown: [1, 2, 3, 4], seeAll: true });
  });
});
