import { describe, expect, it } from "vitest";
import { advance, pathLen, zoomSpeed, type Walker } from "./motion";

const walker = (path: { x: number; z: number }[], zoom = true): Walker =>
  ({ p: { x: 0, z: 0 }, heading: 0, path: [...path], walk: 0, moving: false, speed: zoom ? zoomSpeed(pathLen({ x: 0, z: 0 }, path), false) : 3.6, pause: 0, zoom });
const secondsToArrive = (w: Walker) => { let t = 0; while (!advance(w, 1 / 60)) { t += 1 / 60; if (t > 30) break; } return t; };

describe("the shopper zooms", () => {
  // A long walk across a big store, in many small grid steps.
  const across = Array.from({ length: 60 }, (_, i) => ({ x: (i + 1) * 0.4, z: i % 2 ? 0.2 : 0 }));
  it("crosses the whole store in about a second, however far", () => {
    expect(secondsToArrive(walker(across))).toBeLessThan(1.1);
    expect(secondsToArrive(walker(across.slice(0, 5)))).toBeLessThan(0.9);
  });
  it("is many times faster than the old walk", () => {
    expect(secondsToArrive(walker(across, false))).toBeGreaterThan(5);
  });
  it("ends exactly on the stop and reports one arrival", () => {
    const w = walker(across);
    let arrivals = 0;
    for (let i = 0; i < 200; i++) if (advance(w, 1 / 60)) arrivals++;
    expect(arrivals).toBe(1);
    expect(w.p).toEqual(across[across.length - 1]);
    expect(w.moving).toBe(false);
  });
  it("jumps straight there with reduced motion", () => {
    const w = walker(across); w.speed = zoomSpeed(pathLen(w.p, across), true);
    expect(advance(w, 1 / 60)).toBe(true);
  });
});
