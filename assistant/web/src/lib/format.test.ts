import { fmtDate, qtyTag, money } from "./format";
import { friendlyError } from "./api";

test("format helpers match the plain-JS app", () => {
  expect(fmtDate("2026-10-29")).toBe("Oct 29, 2026");
  expect(qtyTag({ qty: 2 })).toBe("x2");
  expect(qtyTag({ qty: 1.5, unit: "kg" })).toBe("1.5 kg");
  expect(qtyTag({ qty: 1 })).toBe("");
  expect(money(-3.5, { code: "EUR", symbol: "€" })).toBe("€3.50");
  expect(friendlyError("no such session.")).toMatch(/hunt is gone/);
});
