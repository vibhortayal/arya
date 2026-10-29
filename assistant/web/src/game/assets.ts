/* Where the game finds its pictures. In the Arya app they are served
 * from the PWA's /assets mount; the standalone lab bundles them and
 * swaps the resolver. Paths are relative to assets/ ("characters/egg.webp"). */
let resolve = (p: string) => "/assets/" + p;
export const setAssetResolver = (fn: (p: string) => string) => { resolve = fn; };
export const img = (p: string) => resolve(p);
export const charArt = (file: string) => resolve("characters/" + file);

/* The painted scene behind a section's shelf card. Template sections
 * have their own; any other section borrows its kind's (aisles by id). */
const SCENES = new Set(["produce", "bakery", "deli", "meat", "dairy", "frozen", "aisle1", "aisle2", "aisle3", "aisle4"]);
export function sceneArt(s: { id: string; kind: string }) {
  if (SCENES.has(s.id)) return img(`quest/${s.id}.webp`);
  if (s.kind !== "aisle") return img(`quest/${s.kind}.webp`);
  const n = [...s.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return img(`quest/aisle${(n % 4) + 1}.webp`);
}
