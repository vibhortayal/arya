import en from "../i18n/en.json";
import { demoTour } from "./demoTour";

/* The demo's per-screen Tour (owner, 2026-10-31): every step has its text,
 * screens come in tab order, each screen starts at its tab, and only the
 * last step offers the Arya guide. */
const get = (path: string): unknown => path.split(".").reduce<unknown>((d, p) => (d && typeof d === "object" ? (d as Record<string, unknown>)[p] : undefined), en);

describe("demoTour", () => {
  const seen: string[] = [];
  const steps = demoTour(v => { seen.push(v); });
  test("every step has its title, line and screen name", () => {
    for (const s of steps) {
      expect(typeof get(s.titleKey)).toBe("string");
      expect(typeof get(s.bodyKey)).toBe("string");
      expect(typeof get(s.screen!)).toBe("string");
    }
  });
  test("six screens in tab order, each starting at its tab button", () => {
    const order = steps.map(s => s.screen).filter((x, i, a) => a.indexOf(x) === i);
    expect(order).toEqual(["today", "lists", "ask", "quest", "help", "settings"].map(x => `tabs.${x}`));
    for (const sc of order) expect(String(steps.find(s => s.screen === sc)!.target)).toContain("#tabs button");
  });
  test("a screen's stops are one run; a step opens its screen; the guide is offered last", () => {
    const runs = steps.filter((s, i) => i === 0 || steps[i - 1].screen !== s.screen).length;
    expect(runs).toBe(6);
    steps[3].onEnter!();
    expect(seen).toEqual(["home"]);
    expect(steps.filter(s => s.more).length).toBe(1);
    expect(steps[steps.length - 1].more).toBeTruthy();
    expect(steps.length).toBeGreaterThanOrEqual(14);
  });
});
