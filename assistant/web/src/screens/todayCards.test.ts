import { addCard, cardsForFocus, cardsOff, cardsOn, DEFAULT_CARDS, moveCard, removeCard, sizeOf } from "./todayCards";

describe("customizable Today", () => {
  test("null or junk is the default; unknown ids and repeats drop", () => {
    expect(cardsOn(null)).toEqual(DEFAULT_CARDS);
    expect(cardsOn("low")).toEqual(DEFAULT_CARDS);
    expect(cardsOn(["price", "nope", "low", "price"])).toEqual(["price", "low"]);
    expect(cardsOn([])).toEqual([]);
  });

  test("More cards lists what is off, in the default order", () => {
    expect(cardsOff(["quest", "low"])).toEqual(["lists", "report", "price", "expiry", "checks", "patterns"]);
    expect(cardsOff(DEFAULT_CARDS)).toEqual([]);
  });

  test("move, remove, add", () => {
    expect(moveCard(["a", "b", "c"] as any, "c" as any, 0)).toEqual(["c", "a", "b"]);
    expect(moveCard(["low", "lists"], "low", 9)).toEqual(["lists", "low"]);
    expect(moveCard(["low", "lists"], "low", -1)).toEqual(["low", "lists"]);
    expect(removeCard(["low", "lists"], "low")).toEqual(["lists"]);
    // An added card lands on top; adding twice changes nothing.
    expect(addCard(["lists"], "price")).toEqual(["price", "lists"]);
    expect(addCard(["price", "lists"], "price")).toEqual(["price", "lists"]);
  });

  test("the answers lead Today and nothing is removed", () => {
    const money = cardsForFocus(["money"]);
    expect(money.slice(0, 2)).toEqual(["price", "patterns"]);
    expect([...money].sort()).toEqual([...DEFAULT_CARDS].sort());
    expect(cardsForFocus(["faster", "waste"]).slice(0, 3)).toEqual(["expiry", "checks", "lists"]);
    expect(cardsForFocus([])).toEqual(DEFAULT_CARDS);
  });
});

describe("card sizes", () => {
  test("Medium unless a size the card has was saved", () => {
    expect(sizeOf(null, "low")).toBe("m");
    expect(sizeOf({ low: "s" }, "low")).toBe("s");
    expect(sizeOf({ patterns: "l" }, "patterns")).toBe("m"); // Spending has no Large
    expect(sizeOf({ low: "xl" }, "low")).toBe("m");
  });
});
