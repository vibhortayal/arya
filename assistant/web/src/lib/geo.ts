import { clearOnSignOut } from "../app/session";

/* The phone's position, for ranking store search by distance. Kept in
 * memory only, for this session: never stored, cleared on sign-out. */
export type Geo = { lat: number; lng: number; acc?: number };
export class GeoError extends Error {
  constructor(public code: "cannot" | "denied") { super(code); }
}

let known: Geo | null = null;
clearOnSignOut(() => { known = null; });
export const knownGeo = () => known;

const read = () => new Promise<Geo>((resolve, reject) => {
  if (!navigator.geolocation) { reject(new GeoError("cannot")); return; }
  navigator.geolocation.getCurrentPosition(
    p => { known = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; resolve(known); },
    () => reject(new GeoError("denied")),
    { timeout: 8000 });
});

/* A tap on Near me: may show the browser's permission prompt. */
export const askGeo = () => read();

/* Typing a name: reads the position only when the person has already
 * allowed it, so a search never opens a prompt. */
export async function quietGeo(): Promise<Geo | null> {
  if (known) return known;
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" });
    if (st && st.state === "granted") return await read();
  } catch { /* no permission API, or the read failed: search without it */ }
  return null;
}

/* Is the phone at this store? A soft answer, used for notes and for the
 * live walk in Map my store; the position is compared here and dropped.
 * near: within 300 m, or the GPS accuracy if that is larger (indoor
 * fixes drift). far: clearly elsewhere. unsure: the store has no
 * coordinates, or the fix is too rough to tell. denied: no permission or
 * no GPS. Demo Town stores are not real places: always "near". */
export type Here = "near" | "far" | "unsure" | "denied";
export type Place = { id?: string; lat?: number | null; lng?: number | null };
const NEAR_M = 300;

export function meters(a: Geo, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

export function judge(g: Geo, store: Place): Here {
  if (store.lat == null || store.lng == null) return "unsure";
  if ((g.acc ?? 0) > 2000) return "unsure"; // a city-sized fix says nothing
  const d = meters(g, { lat: store.lat, lng: store.lng });
  const slack = Math.max(NEAR_M, g.acc ?? 0);
  if (d <= slack) return "near";
  return d > slack * 2 ? "far" : "unsure";
}

export async function hereAt(store: Place, ask = askGeo): Promise<Here> {
  if (store.id?.startsWith("town-")) return "near";
  let g: Geo;
  try { g = await ask(); } catch { return "denied"; }
  return judge(g, store);
}
