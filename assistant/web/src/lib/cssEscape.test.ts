import { cssEscape } from "../test-setup";

describe("CSS.escape in tests", () => {
  it("is available under jsdom", () => {
    expect(typeof CSS.escape).toBe("function");
  });
  it("follows the CSSOM escape rules", () => {
    expect(cssEscape("line-3")).toBe("line-3");
    expect(cssEscape("a b")).toBe("a\\ b");
    expect(cssEscape("1a")).toBe("\\31 a");
    expect(cssEscape("-1")).toBe("-\\31 ");
    expect(cssEscape("-")).toBe("\\-");
    expect(cssEscape('x"]')).toBe('x\\"\\]');
  });
});
