import { describe, it, expect, vi } from "vitest";
import { keyboardInset, installKeyboardInset } from "./keyboard";

function fakeWin(inner: number, vvH: number, off = 0) {
  const listeners: Record<string, () => void> = {};
  const vv = { height: vvH, offsetTop: off, addEventListener: (k: string, f: () => void) => { listeners[k] = f; }, removeEventListener: vi.fn() };
  return { w: { innerHeight: inner, visualViewport: vv, document } as unknown as Window, vv, listeners };
}

describe("keyboard inset", () => {
  it("is 0 without a visual viewport or keyboard", () => {
    expect(keyboardInset({ innerHeight: 800 } as Window)).toBe(0);
    expect(keyboardInset(fakeWin(800, 800).w)).toBe(0);
  });
  it("measures the covered height", () => {
    expect(keyboardInset(fakeWin(844, 500).w)).toBe(344);
    expect(keyboardInset(fakeWin(844, 500, 100).w)).toBe(244);
  });
  it("publishes --kb and kb-open", () => {
    const f = fakeWin(844, 500);
    const off = installKeyboardInset(f.w);
    expect(document.documentElement.style.getPropertyValue("--kb")).toBe("344px");
    expect(document.documentElement.classList.contains("kb-open")).toBe(true);
    off();
  });
});
