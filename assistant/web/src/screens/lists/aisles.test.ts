import { describe, expect, it } from "vitest";
import { groupByAisle, matchesFind, OTHER } from "./aisles";
import type { Item } from "./model";

const it_ = (name: string, aisle?: string): Item => ({ item_id: name, name, aisle });
const many = (n: number, aisle?: string) => Array.from({ length: n }, (_, k) => it_("x" + k, aisle));

describe("groupByAisle", () => {
  it("leaves a short list flat", () => { expect(groupByAisle(many(11, "Produce"))).toBeNull(); });
  it("groups in department order with Other last", () => {
    const g = groupByAisle([...many(4, "Dairy"), ...many(6, "Produce"), ...many(2)])!;
    expect(g.map(x => x.aisle)).toEqual(["Produce", "Dairy", OTHER]);
  });
  it("stays flat when over a third is unknown", () => { expect(groupByAisle([...many(7, "Dairy"), ...many(5)])).toBeNull(); });
  it("treats an unknown department name as Other", () => {
    expect(groupByAisle([...many(10, "Produce"), it_("a", "Weird"), it_("b", "Weird")])!.pop()!.aisle).toBe(OTHER);
  });
});

describe("matchesFind", () => {
  it("matches any part of the name, ignoring case and punctuation", () => {
    expect(matchesFind(it_("Trader Joe's Hummus"), "joe s")).toBe(true);
    expect(matchesFind(it_("Milk"), "")).toBe(true);
    expect(matchesFind(it_("Milk"), "eggs")).toBe(false);
  });
});
