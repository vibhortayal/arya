import { storeAlerts } from "./Today";

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
    const items = [{ item_id: "m", name: "Milk" }, { item_id: "b", name: "Bread" }];
    const h: any = { list: { items }, price_by_store: {
      m: { Costco: { median: 4.29 }, "Trader Joe's": { median: 4.79 } },
      b: { Costco: { median: 3.0 } } } };
    const rows = storeAlerts(h, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("Milk is cheaper at Costco");
    expect(rows[0].sub).toContain("$4.29 there, $4.79 at Trader Joe's");
    h.price_by_store.m["Trader Joe's"].median = 4.39; // 10 cents: not news
    expect(storeAlerts(h, [])).toEqual([]);
  });

  test("three reports at most, four rows at most", () => {
    const news = Array.from({ length: 5 }, (_, k) => ({ store: "S", item: "i" + k, count: 1, reported_at: "" }));
    const items = [{ item_id: "a", name: "A" }, { item_id: "b", name: "B" }];
    const gap = { X: { median: 1 }, Y: { median: 2 } };
    const rows = storeAlerts({ list: { items }, price_by_store: { a: gap, b: gap } }, news);
    expect(rows.map(r => r.kind)).toEqual(["report", "report", "report", "price"]);
  });
});
