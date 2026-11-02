import { describe, expect, it } from "vitest";
import { replyChoices } from "./replyChoices";

describe("replyChoices", () => {
  it("keeps label and send, drops bad rows and repeats", () => {
    expect(replyChoices([
      { label: "Costcozy", send: "Add milk to Costcozy" },
      { label: "Costcozy", send: "Add milk to Costcozy" },
      { label: "", send: "x" }, null, "str", { label: "Run" },
      { label: " Costco Run ", send: " Add milk to Costco Run " },
    ])).toEqual([
      { label: "Costcozy", send: "Add milk to Costcozy" },
      { label: "Costco Run", send: "Add milk to Costco Run" },
    ]);
  });
  it("is empty for a missing field and caps at 6", () => {
    expect(replyChoices(undefined)).toEqual([]);
    expect(replyChoices({})).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ({ label: "L" + i, send: "Add x to L" + i }));
    expect(replyChoices(many)).toHaveLength(6);
  });
});
