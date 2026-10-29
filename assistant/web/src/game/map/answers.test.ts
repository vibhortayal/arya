import { describe, expect, it } from "vitest";
import { FOCUS, LOOKS, fromAnswers, type Answers } from "./answers";
import { problems } from "./graph";
import { solve } from "./solve";
import { PRESETS } from "./presets";
import { guessType } from "../ui/Build";

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("Build: answers -> a whole store", () => {
  const types: Answers["type"][] = [...(Object.keys(PRESETS) as Answers["type"][]), "cuisine", "single"];
  it("every answer set gives a store that follows the rules and solves without overlaps", () => {
    for (const type of types) for (const l of LOOKS) for (const n of [0, 1, 3, FOCUS.length]) {
      const g = fromAnswers({ type, look: l.id, focus: FOCUS.slice(0, n).map(f => f.id), cuisine: "Turkish", name: "Spice Bazaar" });
      expect(problems(g), `${type} ${l.id} ${n}`).toEqual([]);
      expect(g.look).toBe(l.id);
      const p = solve(g);
      for (let i = 0; i < p.sections.length; i++) for (let j = i + 1; j < p.sections.length; j++)
        expect(overlaps(p.sections[i].rect, p.sections[j].rect), `${type}: ${p.sections[i].id}/${p.sections[j].id}`).toBe(false);
    }
  });
  it("a cuisine names the pantry; one kind of food takes the back wall", () => {
    const c = fromAnswers({ type: "cuisine", cuisine: "turkish", look: "market", focus: [] });
    expect(c.zones.some(z => z.label === "Turkish pantry")).toBe(true);
    const s = fromAnswers({ type: "single", cuisine: "cheese", look: "market", focus: [] });
    const back = s.zones.find(z => z.band === "back")!;
    expect([back.label, back.size, back.categories]).toEqual(["Cheese", "l", ["cheese"]]);
  });
  it("what should be big grows a zone or adds one, and centre aisles stay numbered", () => {
    const g = fromAnswers({ type: "corner", look: "neon", focus: ["snacks", "household", "bakery"] });
    expect(g.zones.find(z => z.id === "snacks")?.size).toBe("l");
    expect(g.zones.some(z => z.kind === "bakery")).toBe(true);
    const centre = g.zones.filter(z => z.band === "centre").sort((a, b) => a.index - b.index);
    expect(centre.map(z => z.short)).toEqual(centre.map((_, i) => `Aisle ${i + 1}`));
    expect(centre.some(z => z.label.endsWith("Household"))).toBe(true);
  });
  it("is deterministic", () => {
    const a: Answers = { type: "health", look: "farm", focus: ["drinks", "frozen"] };
    expect(fromAnswers(a)).toEqual(fromAnswers(a));
  });
  it("guesses a real store's type from its name", () => {
    expect(guessType("Costco Wholesale")).toBe("warehouse");
    expect(guessType("Whole Foods Market")).toBe("health");
    expect(guessType("Patel Brothers")).toBe("indian");
    expect(guessType("Trader Joe's")).toBe("supermarket");
  });
});
