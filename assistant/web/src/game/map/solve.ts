/* solve(): a store graph -> a plan. Deterministic and pure. Bands are
 * strips along the walls, the centre holds numbered aisles between
 * racks, and zones in a band share its length by size. Plan units
 * are the game's (the template store is 360 x 440); the 3D world
 * divides by 20.
 *
 *   back:  y 14..56, from x 70 to the right wall
 *   left:  x 14..62, from y 64 down to the front walkway (index 0 nearest the doors)
 *   right: x w-60..w-14, from y 66 down (index 0 nearest the front)
 *   centre: aisle i at x 108 + 50i between racks at 92 + 50i
 *   front: low tables between the doors and the tills */
import type { Pt, Rect, Section, SectionKind } from "../core/types";
import { inBand, type StoreGraph, type Zone, type ZoneSize } from "./graph";

export type Plan = { w: number; h: number; sections: Section[]; racks: Rect[]; entry: Pt; checkout: Pt };

const WEIGHT: Record<ZoneSize, number> = { s: 50, m: 66, l: 76 };
const DEPTH: Record<ZoneSize, number> = { s: 360, m: 440, l: 520 };
const GAP = 6;

const LOOK: Record<SectionKind, { color: number; ink: number; typical: string }> = {
  produce: { color: 0xddefd3, ink: 0x2f5a1f, typical: "Usually by the doors" },
  bakery: { color: 0xf6e3c8, ink: 0x6b4413, typical: "Usually in a front or back corner" },
  deli: { color: 0xf7dcd3, ink: 0x7a2e19, typical: "Usually along the back wall" },
  meat: { color: 0xf3d6dc, ink: 0x7a1f35, typical: "Usually along the back wall" },
  dairy: { color: 0xdce9f7, ink: 0x1e4a7a, typical: "Usually a back corner, far from the doors" },
  frozen: { color: 0xddf1f4, ink: 0x145560, typical: "Usually a long aisle near the checkout" },
  aisle: { color: 0xece5f6, ink: 0x4b2f7a, typical: "Usually a centre aisle" },
};

/* Split a run of `len` among zones by size, with gaps; returns [start, length] pairs. */
function share(zones: Zone[], start: number, len: number): [number, number][] {
  const ws = zones.map(z => WEIGHT[z.size || "m"]), total = ws.reduce((a, b) => a + b, 0);
  const free = len - GAP * Math.max(0, zones.length - 1);
  let at = start;
  return ws.map(w => { const l = Math.round(free * w / total); const r: [number, number] = [at, l]; at += l + GAP; return r; });
}

const shortOf = (z: Zone) => z.short || z.label.split(" · ")[0];

export function solve(g: StoreGraph): Plan {
  const centre = inBand(g, "centre");
  const w = Math.max(260, 92 + 50 * centre.length + 68);
  const h = DEPTH[g.size || "m"];
  const sections: Section[] = [];
  const add = (z: Zone, rect: Rect, node: Pt) => {
    const look = LOOK[z.kind];
    sections.push({ id: z.id, name: z.label, short: shortOf(z), kind: z.kind, rect, node, color: look.color, ink: look.ink, typical: z.kind === "aisle" && z.band !== "centre" ? "Usually along a wall" : look.typical, band: z.band });
  };

  // Back wall, left to right.
  const back = inBand(g, "back");
  share(back, 70, w - 14 - 70).forEach(([x, l], i) => add(back[i], { x, y: 14, w: l, h: 42 }, { x: Math.round(x + l / 2), y: 41 }));

  // Side walls: index 0 nearest the front, so the run is laid out bottom-up.
  const side = (band: "left" | "right", x: number, sw: number, y0: number, y1: number) => {
    const zs = inBand(g, band);
    share(zs, y0, y1 - y0).forEach(([y, l], i) => {
      const yy = y0 + y1 - (y + l); // mirrored: the first zone sits at the bottom
      add(zs[i], { x, y: yy, w: sw, h: l }, { x: Math.round(x + sw / 2), y: Math.round(yy + l / 2) });
    });
  };
  side("left", 14, 48, 64, h - 106);
  side("right", w - 60, 46, 66, h - 124);

  // Centre aisles between racks; stops alternate low and high so the route snakes.
  centre.forEach((z, i) => add(z, { x: 108 + 50 * i, y: 92, w: 34, h: h - 214 }, { x: 125 + 50 * i, y: i % 2 === 0 ? h - 180 : 150 }));
  const racks = centre.length ? Array.from({ length: centre.length + 1 }, (_, i) => ({ x: 92 + 50 * i, y: 92, w: 16, h: h - 214 })) : [];

  // Front tables, by the doors.
  const front = inBand(g, "front");
  share(front, 70, Math.round(w * 0.45) - 70).forEach(([x, l], i) => add(front[i], { x, y: h - 96, w: l, h: 30 }, { x: Math.round(x + l / 2), y: h - 81 }));

  return { w, h, sections, racks, entry: { x: 48, y: h - 16 }, checkout: { x: Math.round(w * 0.625), y: h - 44 } };
}
