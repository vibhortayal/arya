import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QFX, qCelebHide, qCelebResolve, qOnCollected, qRewardGrab } from "./fx";
import { qHaulPoints, type Session } from "./model";

/* The collect celebration (tests/test_celebration.py's node harness,
 * against the port): which character and fact an item resolves to
 * from the real manifest, and the owner-disabled hook stays silent. */
// vitest runs from web/; the manifest is in the static folder.
const MANIFEST = JSON.parse(readFileSync(resolve(process.cwd(), "../pwa/assets/characters/manifest.json"), "utf8"));
const R = (n: string) => qCelebResolve(n, MANIFEST)!;

test("exact item first, then category, char and fact independently", () => {
  expect(R("Blueberries").char).toBe("blueberry.webp");
  expect(R("Blueberries").fact).toContain("bloom");
  expect(R("Organic Bananas").char).toBe("banana.webp");
  expect(R("Organic Bananas").fact!.startsWith("Botanically")).toBe(true);
  expect(R("Strawberries").char).toBe("fruit.webp");
  expect(R("Strawberries").fact).toContain("200 of them");
  expect(R("Whole Milk").char).toBe("milk.webp");
  expect(R("Whole Milk").fact).toContain("Swiss cheese");
  expect(R("Eggs 12ct").char).toBe("egg.webp");
  expect(R("Eggs 12ct").fact).toContain("shell color");
  expect(R("Eggplant").char).toBe("vegetable.webp");
  expect(R("Eggplant").fact).toBeNull();
  expect(R("Olive Oil").char).toBe("olive-oil.webp");
  expect(R("Olive Oil").fact).toContain("1,000 years");
  expect(R("Peanut Butter").char).toBe("peanut-butter.webp");
  expect(R("Peanut Butter").fact).toContain("540 peanuts");
  expect(R("KS Almonds").char).toBe("almond.webp");
  expect(R("KS Almonds").fact).toContain("cousins of peaches");
  expect(R("Frozen Pizza").char).toBe("pizza.webp");
  expect(R("Ice Cream").char).toBe("frozen.webp");
  expect(R("Ice Cream").fact).toContain("Pizza Month");
  expect(R("Greek Yogurt").char).toBe("dairy.webp");
  expect(R("Greek Yogurt").fact).toContain("Swiss cheese");
  expect(R("Bagels").char).toBe("bakery.webp");
  expect(R("Bagels").fact).toContain("10,000 years");
  expect(R("Carrots").char).toBe("vegetable.webp");
  expect(R("Carrots").fact).toBeNull();
  expect(R("Granola").char).toBe("pantry.webp");
  expect(R("Granola").fact).toContain("300 shapes");
  expect(qCelebResolve("Durian", MANIFEST)).toBeNull();
  expect(qCelebResolve("Milk", null)).toBeNull();
});

test("the collect hook is owner-disabled: the layer stays empty", () => {
  const layer = document.createElement("div");
  layer.id = "celeb-layer";
  layer.hidden = true;
  document.body.appendChild(layer);
  qOnCollected("Blueberries");
  expect(layer.hidden).toBe(true);
  expect(layer.innerHTML).toBe("");
  qCelebHide();
  expect(layer.hidden).toBe(true);
  layer.remove();
});

/* Rewards (tests/test_rewards.py's node harness, against the port):
 * milestones fire once as they are crossed, the full haul bursts once,
 * a put back takes points away from the haul only, a run of quick
 * grabs is quiet, Express never celebrates, and sound starts off. */
describe("rewards", () => {
  const mk = (n: number, mode = "quest"): Session => ({ id: "s1", store: "TJ", mode, state: "playing",
    items: Array.from({ length: n }, (_, i) => ({ name: "I" + i, qty: 1, checked: false, group: "g" + i })) });
  let shown: string[], bursts: number, els: HTMLElement[];
  beforeEach(() => {
    shown = []; bursts = 0;
    const m = document.createElement("div");
    m.id = "milestone";
    Object.defineProperty(m, "textContent", { set(v: string) { shown.push(v); }, get() { return shown[shown.length - 1] || ""; } });
    const cv = document.createElement("canvas");
    cv.id = "confetti";
    (cv as any).getContext = () => { bursts++; return null; };
    document.body.append(m, cv);
    els = [m, cv];
  });
  afterEach(() => { els.forEach(e => e.remove()); });
  const grab = (s: Session, i: number) => {
    const before = s.items.filter(x => x.checked).length;
    s.items[i].checked = true;
    qRewardGrab(s, before, { wasSuggested: true, boss: false });
  };

  test("milestones in order, one full-haul burst, points follow a put back", () => {
    const s = mk(8);
    for (let i = 0; i < 8; i++) grab(s, i);
    expect(shown.slice(0, 2)).toEqual(["Halfway there!", "One to go!"]);
    expect(shown[shown.length - 1]).toBe("All in your cart! Full haul!");
    expect(bursts).toBe(1);
    expect(qHaulPoints(s, false)).toBe(105);
    expect(qHaulPoints(s, true)).toBe(155);
    s.items[7].checked = false;
    expect(qHaulPoints(s, false)).toBe(70);
  });

  test("three quick grabs stay quiet; Express never celebrates; sound starts off", () => {
    const s = mk(12);
    grab(s, 0); grab(s, 1); grab(s, 2);
    expect(shown).toEqual([]);
    const e = mk(2, "express");
    grab(e, 0); grab(e, 1);
    expect(shown).toEqual([]);
    expect(bursts).toBe(0);
    expect(QFX.on).toBe(false);
  });
});
