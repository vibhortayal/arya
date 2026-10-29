/* Where the game finds its pictures. In the Arya app they are served
 * from the PWA's /assets mount; the standalone lab bundles them and
 * swaps the resolver. Paths are relative to assets/ ("characters/egg.webp"). */
let resolve = (p: string) => "/assets/" + p;
export const setAssetResolver = (fn: (p: string) => string) => { resolve = fn; };
export const img = (p: string) => resolve(p);
export const charArt = (file: string) => resolve("characters/" + file);
