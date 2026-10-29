import { clampBox, coverBox } from "./Capture";

describe("scan outlines land where Arya saw them", () => {
  it("maps a frame box through object-fit: cover", () => {
    // A 4:3 landscape frame in a 300x400 portrait box: scaled to 400 high, 533 wide, centred.
    const r = coverBox([0.5, 0, 1, 0.5], 640, 480, 300, 400);
    expect(Math.round(r.left)).toBe(150);
    expect(Math.round(r.width)).toBe(267);
    expect(Math.round(r.height)).toBe(200);
  });
  it("keeps an outline inside the camera box", () => {
    expect(clampBox({ left: -40, top: 10, width: 100, height: 50 }, 300, 400)).toEqual({ left: 0, top: 10, width: 60, height: 50 });
  });
});
