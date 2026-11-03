import { describe, expect, it } from "vitest";
import { hideValue, isHidden } from "./todayHidden";

describe("today hidden rows", () => {
  it("hides a row while its signature holds", () => {
    const m = { "l:milk": hideValue('"[3,5]"', "2026-11-03") };
    expect(isHidden(m, "l:milk", '"[3,5]"', "2026-12-30")).toBe(true);
    expect(isHidden(m, "l:milk", '"[9,12]"', "2026-11-04")).toBe(false); // bought again: back
    expect(isHidden(m, "l:eggs", "x", "2026-11-04")).toBe(false);
    expect(isHidden(undefined, "l:milk", "x")).toBe(false);
  });
  it("store alerts come back after 4 days, price rows after 30", () => {
    const m = { "r:Corner|Milk": hideValue("", "2026-11-03"), "p:milk": hideValue("Fresh", "2026-11-03") };
    expect(isHidden(m, "r:Corner|Milk", "", "2026-11-07")).toBe(true);
    expect(isHidden(m, "r:Corner|Milk", "", "2026-11-08")).toBe(false);
    expect(isHidden(m, "p:milk", "Fresh", "2026-12-03")).toBe(true);
    expect(isHidden(m, "p:milk", "Fresh", "2026-12-04")).toBe(false);
    expect(isHidden(m, "p:milk", "Corner", "2026-11-04")).toBe(false);
  });
  it("keeps a signature that contains a bar", () => {
    const m = { empty: hideValue("A|B", "2026-11-03") };
    expect(isHidden(m, "empty", "A|B", "2026-11-04")).toBe(true);
  });
});
