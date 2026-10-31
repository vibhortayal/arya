import { describe, expect, it } from "vitest";
import { spread, WALK_MAX_FRAMES } from "./scanQueue";

describe("spread", () => {
  it("keeps every frame of a short walk", () => {
    expect(spread(3, WALK_MAX_FRAMES)).toEqual([0, 1, 2]);
  });
  it("keeps an even spread of a long walk", () => {
    const k = spread(180, 40);
    expect(k).toHaveLength(40);
    expect(k[0]).toBe(2);
    expect(k[39]).toBe(177);
    expect(new Set(k).size).toBe(40);
  });
});
