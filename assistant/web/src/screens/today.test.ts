import { emptyListsLine, findingLine, nextTrip, staleThrough, storeAlerts, todaysTip, watchRows } from "./Today";

/* Today's Store alerts rows, as the plain-JS app's node harness ran
 * app.js storeAlertRows (tests/test_list_first.py TestStoreAlerts). */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

describe("store alerts", () => {
  test("a report marks an item on your list", () => {
    const h = { list: { items: [{ item_id: "e", name: "Eggs", checked: false, on_list: true }] }, price_by_store: {} };
    const rows = storeAlerts(h, [{ store: "Costco", item: "eggs", count: 2, reported_at: "2026-10-28T10:00" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("eggs: out at Costco");
    expect(rows[0].sub).toContain("2 reports");
    expect(rows[0].sub).toContain("on your list");
    // not on the list: no mark
    const off = storeAlerts({ list: { items: [] } }, [{ store: "Costco", item: "eggs", count: 1, reported_at: "2026-10-28" }]);
    expect(off[0].sub).toContain("1 report ");
    expect(off[0].sub).not.toContain("on your list");
  });

  test("a price row needs two stores and a real gap", () => {
    const items = [{ item_id: "m", name: "Milk", on_list: true }, { item_id: "b", name: "Bread", on_list: true }];
    const h: any = { list: { items }, price_by_store: {
      m: { Costco: { median: 4.29 }, "Trader Joe's": { median: 4.79 } },
      b: { Costco: { median: 3.0 } } } };
    const rows = storeAlerts(h, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("Milk: cheaper at Costco");
    expect(rows[0].sub).toContain("$4.29 there, $4.79 at Trader Joe's");
    h.price_by_store.m["Trader Joe's"].median = 4.39; // 10 cents: not news
    expect(storeAlerts(h, [])).toEqual([]);
  });

  test("three reports at most, four rows at most", () => {
    const news = Array.from({ length: 5 }, (_, k) => ({ store: "S", item: "i" + k, count: 1, reported_at: "" }));
    const items = [{ item_id: "a", name: "A", on_list: true }, { item_id: "b", name: "B", on_list: true }];
    const gap = { X: { median: 1 }, Y: { median: 2 } };
    const rows = storeAlerts({ list: { items }, price_by_store: { a: gap, b: gap } }, news);
    expect(rows.map(r => r.kind)).toEqual(["report", "report", "report", "price"]);
  });
});

describe("relevant cards (owner 2026-10-30)", () => {
  test("a price row is only for something on a list now", () => {
    const gap = { X: { median: 1 }, Y: { median: 2 } };
    const off = storeAlerts({ list: { items: [{ item_id: "a", name: "A", on_list: false }] }, price_by_store: { a: gap } }, []);
    expect(off).toEqual([]);
    const done = storeAlerts({ list: { items: [{ item_id: "a", name: "A", on_list: true, checked: true }] }, price_by_store: { a: gap } }, []);
    expect(done).toEqual([]);
  });
  test("empty lists fold into one line", () => {
    expect(emptyListsLine(["Costco"])).toBe("Costco is empty");
    expect(emptyListsLine(["Costco", "Indian Store", "Trader Joe"])).toBe("Costco, Indian Store and Trader Joe are empty");
    expect(emptyListsLine(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more lists are empty");
  });
  test("the tip line is a real finding when there is one", () => {
    const ins = { basket: { since_month: "June", movers: [{ item_id: "b", name: "Sourdough Loaf", pct: 6.6 }] } };
    const h = { price_by_store: { b: { "Trader Joe's": { median: 5.2 }, Safeway: { median: 5.6 } } } };
    expect(findingLine(ins, h)).toBe("Sourdough Loaf costs 6.6% more than in June. Cheaper at Trader Joe's.");
    // Under 5% is not news; a cheaper store for an item is.
    const small = { basket: { since_month: "June", movers: [{ name: "Eggs", pct: 2 }] },
      split: { moves: [{ name: "Whole Milk 1 gal", to: "Safeway", month_dollars: 1.48 }] } };
    expect(findingLine(small, {})).toBe("Buy Whole Milk 1 gal at Safeway: about $1.48 a month less.");
    expect(findingLine(null, {})).toBeNull();
  });
  test("a tip only for a power one step from turning on", () => {
    try { localStorage.clear(); } catch { /* none */ }
    expect(todaysTip({ receipts: 30, stores: 3, share_prices: true })).toBeNull(); // all on: the finding speaks
    expect(todaysTip({ receipts: 0, stores: 0, share_prices: false })).toBeNull(); // a new account: nothing yet
    expect(todaysTip({ receipts: 2, stores: 2, share_prices: true })?.id).toBe("trends"); // one receipt away
    expect(["compare", "split"]).toContain(todaysTip({ receipts: 1, stores: 1, share_prices: false })?.id);
  });
  test("the receipts date shows only when a week old", () => {
    expect(staleThrough("2026-10-27", "2026-10-30")).toBe(false);
    expect(staleThrough("2026-10-20", "2026-10-30")).toBe(true);
    expect(staleThrough(undefined, "2026-10-30")).toBe(false);
  });
});

describe("Price watch and Next trip cards", () => {
  const h = { price_by_store: { s: { "Trader Joe's": { median: 3.99 }, Safeway: { median: 5.49 } }, m: { Costco: { median: 4 }, Safeway: { median: 3 } } } };
  test("watch rows keep movers of 5% or more, with the cheaper store", () => {
    const ins = { basket: { since_month: "June", movers: [{ item_id: "s", name: "Sourdough", pct: 6.6 }, { item_id: "x", name: "Rice", pct: 12 }, { name: "Salt", pct: 2 }] } };
    const rows = watchRows(ins, h);
    expect(rows.map(r => r.name)).toEqual(["Sourdough", "Rice"]);
    expect(rows[0]).toMatchObject({ pct: "6.6%", cheaperAt: "Trader Joe's" });
    expect(rows[1]).toMatchObject({ pct: "12%", cheaperAt: null });
    expect(watchRows(null, h)).toEqual([]);
  });
  test("next trip is the fullest list, priced at its own store first", () => {
    const cards = [{ id: "a", name: "Safeway", items: [{ item_id: "s", name: "Soap" }] }, { id: "b", name: "Costco", items: [{ item_id: "m", name: "Milk" }, { item_id: "z", name: "Zucchini" }] }];
    expect(nextTrip(cards, [{ id: "b", stores: ["Costco"] }], h)).toEqual({ id: "b", name: "Costco", count: 2, cost: 4, items: cards[1].items, stores: ["Costco"] });
    // no store on the list: the cheapest price
    expect(nextTrip(cards, [], h)?.cost).toBe(3);
    expect(nextTrip([{ id: "c", name: "New", items: [{ item_id: "z", name: "Zucchini" }] }], [], h)?.cost).toBeNull();
    expect(nextTrip([], [], h)).toBeNull();
  });
});
