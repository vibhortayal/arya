import { BAR_ITEMS, DEFAULT_BAR, barOf, litTab, moreOf, startView } from "./bar";

/* The shopper's bottom bar (owner, 2026-11-01). */
describe("bar", () => {
  test("the default is Today, Spending, Quest, Ask; More holds the rest", () => {
    expect(DEFAULT_BAR).toEqual(["home", "analysis", "community", "chat"]);
    expect(barOf(null)).toEqual(DEFAULT_BAR);
    expect(moreOf(DEFAULT_BAR)).toEqual(["list", "receipts", "stores-mine", "help", "profile"]);
  });
  test("a saved bar is cleaned: unknown ids and repeats drop, four at most, never empty", () => {
    expect(barOf(["list", "receipts", "list", "nope", "stores-mine"])).toEqual(["list", "receipts", "stores-mine"]);
    expect(barOf(["home", "list", "receipts", "analysis", "chat"])).toEqual(["home", "list", "receipts", "analysis"]);
    expect(barOf([])).toEqual(DEFAULT_BAR);
    expect(barOf(["mapper"])).toEqual(DEFAULT_BAR);
  });
  test("every place is on the bar or in More, never both", () => {
    const bar = barOf(["list", "receipts", "stores-mine"]);
    expect([...bar, ...moreOf(bar)].sort()).toEqual([...BAR_ITEMS].sort());
  });
  test("Receipts lights Spending (it sits at its top); Stores lights More; either lights itself when pinned", () => {
    expect(litTab("receipts", DEFAULT_BAR)).toBe("analysis");
    expect(litTab("receipt", DEFAULT_BAR)).toBe("analysis");
    expect(litTab("analysis", DEFAULT_BAR)).toBe("analysis");
    expect(litTab("stores-find", DEFAULT_BAR)).toBe("more");
    expect(litTab("stores-mine", DEFAULT_BAR)).toBe("more");
    expect(litTab("list", DEFAULT_BAR)).toBe("more");
    const mine = barOf(["list", "receipts", "stores-mine"]);
    expect(litTab("receipt", mine)).toBe("receipts");
    expect(litTab("tocheck", DEFAULT_BAR)).toBe("analysis");
    expect(litTab("tocheck", mine)).toBe("receipts");
    expect(litTab("stores-find", mine)).toBe("stores-mine");
  });
  test("a place in More lights More; a screen with no place lights nothing", () => {
    expect(litTab("help", DEFAULT_BAR)).toBe("more");
    expect(litTab("powers", DEFAULT_BAR)).toBe("more");
    expect(litTab("hunt", DEFAULT_BAR)).toBeNull();
    expect(litTab("home", ["list", "receipts"])).toBe("more");
  });
  test("the app opens on Today, or on the first place when Today is off the bar", () => {
    expect(startView(DEFAULT_BAR)).toBe("home");
    expect(startView(barOf(["list", "receipts"]))).toBe("list");
  });
});
