import { clearOnSignOut } from "../app/session";

/* The phone's position, for ranking store search by distance. Kept in
 * memory only, for this session: never stored, cleared on sign-out. */
export type Geo = { lat: number; lng: number };
export class GeoError extends Error {
  constructor(public code: "cannot" | "denied") { super(code); }
}

let known: Geo | null = null;
clearOnSignOut(() => { known = null; });
export const knownGeo = () => known;

const read = () => new Promise<Geo>((resolve, reject) => {
  if (!navigator.geolocation) { reject(new GeoError("cannot")); return; }
  navigator.geolocation.getCurrentPosition(
    p => { known = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(known); },
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
