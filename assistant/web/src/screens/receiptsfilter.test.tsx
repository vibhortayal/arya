import { expect, test } from "vitest";
import { filterReceipts } from "./Receipts";

const R = [
  { receipt_id: "a", merchant: "Costco Sunnyvale", purchased_at: "2026-10-31", total: 212.4, items: 24 },
  { receipt_id: "b", merchant: "Trader Joe's Fremont", purchased_at: "2026-10-28", total: 58.77, items: 14 },
  { receipt_id: "c", merchant: "Costco Cypress", purchased_at: "2026-10-06", total: 412.06, items: 41 },
  { receipt_id: "d", merchant: "Apple Market", purchased_at: "2025-03-01", total: 20, items: 3 },
];
const now = new Date(2026, 10, 1);
const f = (o: object) => filterReceipts(R, { query: "", date: "all", from: "", to: "", sort: "new", ...o } as any, now).map(r => r.receipt_id).join("");

test("sorts", () => {
  expect(f({})).toBe("abcd");
  expect(f({ sort: "old" })).toBe("dcba");
  expect(f({ sort: "high" })).toBe("cabd");
  expect(f({ sort: "low" })).toBe("dbac");
  expect(f({ sort: "store" })).toBe("dcab");
});
test("search store, amount and dollar sign", () => {
  expect(f({ query: "costco" })).toBe("ac");
  expect(f({ query: "$58.7" })).toBe("b");
  expect(f({ query: "safeway" })).toBe("");
});
test("date presets and custom range", () => {
  expect(f({ date: "month" })).toBe("");
  expect(f({ date: "30" })).toBe("abc");
  expect(f({ date: "year" })).toBe("abc");
  expect(f({ date: "custom", from: "2026-10-06", to: "2026-10-28" })).toBe("bc");
  expect(f({ date: "custom", from: "2026-10-29" })).toBe("a");
});
