/* The store as a 3D world: fixtures, a walk grid and where each list
 * item waits. Pure (no three.js, no DOM) so it can be tested alone.
 * World units are plan units / 20: the 360 x 440 plan becomes an
 * 18 x 22 floor. x runs right, z runs toward the doors. */
import { PLAN, RACKS } from "../core/template";
import type { QuestItem, Section, StoreLayout } from "../core/types";

export const U = 20;
export const FLOOR = { w: PLAN.w / U, d: PLAN.h / U };

export type FixKind = "rack" | "bin" | "bread" | "counter" | "fridge" | "freezer" | "checkout" | "plant" | "carts";
export type Fixture = { kind: FixKind; x: number; z: number; w: number; d: number; h: number; section?: string };
export type V2 = { x: number; z: number };
/* Where an item waits: the marker floats at `at`; the shopper stands at `stand` and faces `face` (radians). */
export type Spot = { key: string; section: string; at: V2; stand: V2; face: number };

const w = (p: { x: number; y: number }): V2 => ({ x: p.x / U, z: p.y / U });

/* The fixed furniture of the template store. Sections only change the
 * labels and colours; a store always has its racks, walls and tills. */
export function fixtures(): Fixture[] {
  const F: Fixture[] = [];
  for (const r of RACKS) F.push({ kind: "rack", x: r.x / U, z: r.y / U, w: r.w / U, d: r.h / U, h: 1.7 });
  for (let z = 3.4; z < 16.4; z += 1.65) F.push({ kind: "bin", x: 0.45, z, w: 1.15, d: 1.45, h: 0.8, section: "produce" });
  const back: [string, FixKind, number, number, number][] = [
    ["bakery", "bread", 3.6, 6.7, 1.5], ["deli", "counter", 7.2, 10.3, 1.0], ["meat", "counter", 10.8, 13.1, 1.0], ["dairy", "fridge", 13.6, 17.4, 2.2],
  ];
  for (const [section, kind, x0, x1, h] of back) F.push({ kind, x: x0, z: 0.35, w: x1 - x0, d: 0.95, h, section });
  F.push({ kind: "freezer", x: 16.45, z: 3.4, w: 0.95, d: 12.4, h: 2.1, section: "frozen" });
  for (const x of [9.0, 12.6, 15.2]) F.push({ kind: "checkout", x, z: 18.4, w: 0.85, d: 1.9, h: 0.95 });
  F.push({ kind: "plant", x: 0.4, z: 20.6, w: 0.8, d: 0.8, h: 1.2 }, { kind: "carts", x: 5.2, z: 20.4, w: 1.2, d: 1.2, h: 1.0 });
  return F;
}

/* ---- walk grid: half-unit cells, fixtures padded so nobody clips a shelf ---- */
export const CELL = 0.5;
export type Grid = { gx: number; gz: number; open: Uint8Array };

export function grid(F: Fixture[]): Grid {
  const gx = Math.round(FLOOR.w / CELL), gz = Math.round(FLOOR.d / CELL), open = new Uint8Array(gx * gz);
  const pad = 0.28;
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
    const wall = x < 0.4 || x > FLOOR.w - 0.4 || z < 0.4 || z > FLOOR.d - 0.4;
    open[j * gx + i] = wall || F.some(f => x > f.x - pad && x < f.x + f.w + pad && z > f.z - pad && z < f.z + f.d + pad) ? 0 : 1;
  }
  return { gx, gz, open };
}

const cellOf = (g: Grid, p: V2) => [Math.max(0, Math.min(g.gx - 1, Math.floor(p.x / CELL))), Math.max(0, Math.min(g.gz - 1, Math.floor(p.z / CELL)))] as const;
const centre = (i: number, j: number): V2 => ({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL });
export const isOpen = (g: Grid, p: V2) => { const [i, j] = cellOf(g, p); return g.open[j * g.gx + i] === 1; };

/* The nearest open cell to a point (a tap on a shelf walks to its front). */
export function nearestOpen(g: Grid, p: V2): V2 {
  const [ci, cj] = cellOf(g, p);
  let best: V2 | null = null, bd = Infinity;
  for (let r = 0; r < 12 && !best; r++)
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= g.gx || j >= g.gz || !g.open[j * g.gx + i]) continue;
      const c = centre(i, j), d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
  return best ?? p;
}

/* Clear straight line between two points (sampled every quarter cell). */
function sees(g: Grid, a: V2, b: V2) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 4));
  for (let k = 1; k < n; k++) if (!isOpen(g, { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n })) return false;
  return true;
}

/* Shortest walk (8-way A*), then pulled straight where the floor is clear,
 * so the shopper cuts corners the way people do. Returns the points after `from`. */
export function findPath(g: Grid, from: V2, to: V2): V2[] {
  const s = cellOf(g, nearestOpen(g, from)), t = cellOf(g, nearestOpen(g, to));
  const N = g.gx * g.gz, start = s[1] * g.gx + s[0], goal = t[1] * g.gx + t[0];
  const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), shut = new Uint8Array(N);
  const h = (k: number) => Math.hypot((k % g.gx) - t[0], Math.floor(k / g.gx) - t[1]);
  const open: number[] = [start]; cost[start] = 0;
  while (open.length) {
    let bi = 0; for (let q = 1; q < open.length; q++) if (cost[open[q]] + h(open[q]) < cost[open[bi]] + h(open[bi])) bi = q;
    const k = open.splice(bi, 1)[0];
    if (k === goal) break;
    if (shut[k]) continue; shut[k] = 1;
    const i = k % g.gx, j = Math.floor(k / g.gx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= g.gx || nj >= g.gz) continue;
      const nk = nj * g.gx + ni; if (!g.open[nk] || shut[nk]) continue;
      if (di && dj && (!g.open[j * g.gx + ni] || !g.open[nj * g.gx + i])) continue; // no squeezing past a corner
      const c = cost[k] + (di && dj ? Math.SQRT2 : 1);
      if (c < cost[nk]) { cost[nk] = c; prev[nk] = k; open.push(nk); }
    }
  }
  if (start !== goal && prev[goal] < 0) return [];
  const cells: V2[] = [];
  for (let k = goal; k !== start && k >= 0; k = prev[k]) cells.unshift(centre(k % g.gx, Math.floor(k / g.gx)));
  const pts = [from, ...cells];
  const out: V2[] = [];
  let a = from;
  for (let k = 1; k < pts.length; k++) {
    if (k === pts.length - 1 || !sees(g, a, pts[k + 1])) { out.push(pts[k]); a = pts[k]; }
  }
  return out;
}

export const pathLength = (from: V2, pts: V2[]) => pts.reduce((d, p, i) => d + Math.hypot(p.x - (i ? pts[i - 1] : from).x, p.z - (i ? pts[i - 1] : from).z), 0);

/* Where each item waits along its section's shelves. Items of one
 * section spread out so each has its own marker and standing spot. */
export function spots(layout: StoreLayout, items: QuestItem[], g: Grid): Spot[] {
  const out: Spot[] = [];
  for (const s of layout.sections) {
    const its = items.filter(i => i.section === s.id);
    its.forEach((it, k) => out.push(spotFor(s, k, its.length, it.key, g)));
  }
  return out;
}

function spotFor(s: Section, k: number, n: number, key: string, g: Grid): Spot {
  const node = w(s.node), off = (k - (n - 1) / 2) * 1.3;
  const r = { x: s.rect.x / U, z: s.rect.y / U, w: s.rect.w / U, d: s.rect.h / U };
  const clampZ = (z: number) => Math.max(r.z + 0.8, Math.min(r.z + r.d - 0.8, z));
  const clampX = (x: number) => Math.max(r.x + 0.6, Math.min(r.x + r.w - 0.6, x));
  let at: V2, face: number;
  if (s.kind === "produce") { at = { x: 1.05, z: clampZ(node.z + off) }; face = -Math.PI / 2; }
  else if (s.kind === "frozen") { at = { x: 16.9, z: clampZ(node.z + off) }; face = Math.PI / 2; }
  else if (s.kind === "aisle") {
    // Alternate the racks either side of the aisle.
    const left = k % 2 === 0, z = clampZ(node.z + (Math.floor(k / 2) - (Math.ceil(n / 2) - 1) / 2) * 1.6);
    at = { x: left ? r.x - 0.15 : r.x + r.w + 0.15, z }; face = left ? -Math.PI / 2 : Math.PI / 2;
  } else { at = { x: clampX(node.x + off), z: 0.85 }; face = Math.PI; }
  const toward = { x: at.x - Math.sin(face) * 0.95, z: at.z - Math.cos(face) * 0.95 };
  return { key, section: s.id, at, stand: nearestOpen(g, toward), face };
}

export const toWorld = w;
