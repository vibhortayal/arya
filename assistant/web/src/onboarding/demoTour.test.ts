import en from "../i18n/en.json";
import { demoTour } from "./demoTour";

/* The demo's per-screen Tour (owner, 2026-10-31): every step has its text,
 * screens come in the shopper's bar order (2026-11-01), then More, Help
 * and Settings, then Make the bar yours, which is the only step with a
 * link (Customize now). */
const get = (path: string): unknown => path.split(".").reduce<unknown>((d, p) => (d && typeof d === "object" ? (d as Record<string, unknown>)[p] : undefined), en);
const screens = (steps: ReturnType<typeof demoTour>) => steps.map(s => s.screen).filter((x, i, a) => a.indexOf(x) === i);

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
  test("the default bar's screens in bar order, then More, Help, Settings and the bar step", () => {
    expect(screens(steps)).toEqual(["tabs.today", "tabs.lists", "tabs.quest", "tabs.ask", "tabs.more", "tabs.help", "tabs.settings", "firstRun.tour.bar.screen"]);
    expect(steps[steps.length - 1].id).toBe("bar");
  });
  test("a screen's stops are one run; a step opens its screen; only the last step has a link", () => {
    const runs = steps.filter((s, i) => i === 0 || steps[i - 1].screen !== s.screen).length;
    expect(runs).toBe(8);
    steps[3].onEnter!();
    expect(seen).toEqual(["home"]);
    expect(steps.filter(s => s.more).length).toBe(1);
    expect(steps[steps.length - 1].more?.labelKey).toBe("firstRun.tour.bar.customize");
  });
  test("a custom bar: pinned places lead; Help and Settings on the bar are not repeated", () => {
    const custom = demoTour(() => {}, ["list", "receipts", "profile"]);
    expect(screens(custom)).toEqual(["tabs.lists", "tabs.receipts", "tabs.settings", "tabs.more", "tabs.help", "firstRun.tour.bar.screen"]);
  });
});
