import { fmtDate, fmtShort, qtyTag, money } from "./format";
import { friendlyError } from "./api";

test("format helpers match the plain-JS app", () => {
  expect(fmtDate("2026-10-29")).toBe("Oct 29, 2026");
  expect(qtyTag({ qty: 2 })).toBe("x2");
  expect(qtyTag({ qty: 1.5, unit: "kg" })).toBe("1.5 kg");
  expect(qtyTag({ qty: 1 })).toBe("");
  expect(money(-3.5, { code: "EUR", symbol: "€" })).toBe("€3.50");
  expect(friendlyError("no such session.")).toMatch(/quest ended when the demo reset/);
});

test("short dates carry the year only when it is not this year", () => {
  const y = new Date().getFullYear();
  expect(fmtShort(`${y}-10-29`)).toBe("Oct 29");
  expect(fmtShort(`${y - 1}-03-02`)).toBe(`Mar 2, ${y - 1}`);
});
