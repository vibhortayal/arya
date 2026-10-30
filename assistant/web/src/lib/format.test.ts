import { fmtDate, fmtShort, fmtWeekday, qtyTag, money } from "./format";
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

describe("fmtWeekday", () => {
  test("a receipt date reads like Tue, Oct 27 (year only when not this year)", () => {
    const y = new Date().getFullYear();
    expect(fmtWeekday(`${y}-10-27`)).toMatch(/^[A-Z][a-z]{2}, Oct 27$/);
    expect(fmtWeekday(`${y}-10-27T09:30:00`)).toMatch(/^[A-Z][a-z]{2}, Oct 27$/);
    expect(fmtWeekday("2020-10-27")).toBe("Tue, Oct 27, 2020");
    expect(fmtWeekday("nope")).toBe("nope");
  });
});
