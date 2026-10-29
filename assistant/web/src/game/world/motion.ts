/* How shoppers move through the 3D store. Plain TypeScript, no engine. */
import type { V2 } from "./layout3d";
export type Walker = { p: V2; heading: number; path: V2[]; walk: number; moving: boolean; speed: number; pause: number; zoom?: boolean };

/* The player's shopper zooms (owner, 2026-10-29: no step-by-step
 * walking): any trip across the store takes about ZOOM_S seconds,
 * easing into the stop. Reduced motion jumps straight there. */
export const ZOOM_S = 0.6;
export const pathLen = (from: V2, path: V2[]) => path.reduce((a, q, i) => a + Math.hypot(q.x - (i ? path[i - 1] : from).x, q.z - (i ? path[i - 1] : from).z), 0);
export function zoomSpeed(len: number, reduced: boolean) {
  return reduced ? 1e4 : Math.min(45, Math.max(8, len / ZOOM_S));
}

/* Move a walker along its path for dt seconds; true when it arrives.
 * A zoom covers as many path points as its speed allows in one frame
 * and eases into the stop over the last stretch; a stroll keeps pace. */
export function advance(w: Walker, dt: number): boolean {
  if (!w.path.length) { w.moving = false; return false; }
  const left = w.zoom ? pathLen(w.p, w.path) : Infinity;
  let mv = w.speed * dt * (w.zoom ? Math.min(1, 0.25 + left / 2.5) : 1);
  w.moving = true; w.walk += dt * w.speed * 3.4;
  const t0 = w.path[0], want = Math.atan2(t0.x - w.p.x, t0.z - w.p.z);
  const dh = ((want - w.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  w.heading += dh * Math.min(1, dt * (w.zoom ? 18 : 10));
  while (w.path.length) {
    const t = w.path[0], dx = t.x - w.p.x, dz = t.z - w.p.z, d = Math.hypot(dx, dz);
    if (d > mv) { w.p = { x: w.p.x + dx / d * mv, z: w.p.z + dz / d * mv }; return false; }
    w.p = { ...t }; w.path.shift(); mv -= d;
    if (!w.zoom) break;
  }
  if (w.path.length) return false;
  w.moving = false;
  return true;
}
