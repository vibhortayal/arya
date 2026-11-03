import { describe, expect, it } from "vitest";
import { hereAt, judge, meters } from "./geo";

const store = { id: "s1", lat: 37.5485, lng: -121.9886 };

describe("judge", () => {
  it("is near within 300 m", () => {
    expect(judge({ lat: 37.5490, lng: -121.9886 }, store)).toBe("near");
  });
  it("widens near to the GPS accuracy", () => {
    expect(judge({ lat: 37.5540, lng: -121.9886, acc: 900 }, store)).toBe("near");
  });
  it("is far when clearly elsewhere", () => {
    expect(judge({ lat: 37.80, lng: -122.27 }, store)).toBe("far");
  });
  it("is unsure with a rough fix or no store coordinates", () => {
    expect(judge({ lat: 37.80, lng: -122.27, acc: 40000 }, store)).toBe("unsure");
    expect(judge({ lat: 37.5, lng: -121.9 }, { id: "x" })).toBe("unsure");
  });
  it("measures meters", () => {
    expect(Math.round(meters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }))).toBeGreaterThan(100);
  });
});

describe("hereAt", () => {
  it("never asks for a Demo Town store", async () => {
    let asked = false;
    expect(await hereAt({ id: "town-safeday" }, async () => { asked = true; return { lat: 0, lng: 0 }; })).toBe("near");
    expect(asked).toBe(false);
  });
  it("reports denied when the position cannot be read", async () => {
    expect(await hereAt(store, async () => { throw new Error("no"); })).toBe("denied");
  });
});
