import { describe, expect, test } from "vitest";
import { CSV_HEAD, fileName, toChecklist, toCsv, toJson, toRows } from "./exportFormats";

const rows = toRows([
  { item_id: "a", name: "Avocados", qty: 4, checked: false },
  { item_id: "b", name: 'Milk, "whole"', qty: 2, unit: "gal", checked: true },
  { item_id: "c", name: "Bread" },
], () => "Pantry");

describe("export formats", () => {
  test("checklist marks done items and amounts", () => {
    expect(toChecklist("Costco", rows)).toBe("Costco\n☐ Avocados ×4\n✓ Milk, \"whole\" 2 gal\n☐ Bread");
  });
  test("csv uses the Lists API columns and quotes cells", () => {
    const lines = toCsv("Costco", rows).split("\n");
    expect(lines[0]).toBe(CSV_HEAD);
    expect(lines[2]).toBe('"Milk, ""whole""",2,gal,yes,Pantry,Costco');
  });
  test("json carries the list and items", () => {
    expect(JSON.parse(toJson("Costco", rows)).items).toHaveLength(3);
  });
  test("file names are plain", () => {
    expect(fileName("Trader Joe's", "csv")).toBe("trader-joe-s.csv");
    expect(fileName("", "json")).toBe("list.json");
  });
});
