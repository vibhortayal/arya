import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { qCelebHide, qCelebResolve, qOnCollected } from "./fx";

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
