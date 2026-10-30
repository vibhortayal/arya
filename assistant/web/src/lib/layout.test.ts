import { arrange } from "./layout";

describe("arrange", () => {
  test("saved order first, unknown at the end, hidden out", () => {
    expect(arrange(["a", "b", "c", "d"], ["c", "a"], ["b"])).toEqual({ shown: ["c", "a", "d"], hidden: ["b"] });
  });
  test("nothing saved: as given", () => {
    expect(arrange(["a", "b"])).toEqual({ shown: ["a", "b"], hidden: [] });
  });
  test("saved ids that no longer exist are ignored", () => {
    expect(arrange(["a"], ["gone", "a"], ["gone"])).toEqual({ shown: ["a"], hidden: [] });
  });
});
