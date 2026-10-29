import { useEffect, useState } from "react";
import { asset } from "./format";

/* The character registry (app.js CHARM / charFor, quest.js qFaceFor):
 * the manifest maps an item to its character — exact item first, then
 * category, then the fallback. It only maps an item's identity to art
 * and never guesses a match of its own. One copy for every screen. */

type Rule = { keywords?: string[]; char?: string };
export type Manifest = { items?: Rule[]; categories?: Rule[]; fallback?: string; roles?: Record<string, string> };

let CHARM: Manifest | null = null;
let charLoad: Promise<void> | null = null;

/* Fetches the manifest once; a failed fetch may be tried again later. */
export function loadCharacters(): Promise<void> {
  return charLoad || (charLoad = fetch(asset("assets/characters/manifest.json")).then(r => r.json())
    .then((m: Manifest) => { CHARM = m; }).catch(() => { charLoad = null; }));
}

/* The whole manifest (Profile's avatar presets), or null when it cannot load. */
export async function characterManifest(): Promise<Manifest | null> {
  await loadCharacters();
  return CHARM;
}

const tokensOf = (name: unknown) =>
  String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

function charMatch(tokens: string[], kw: string) {
  const kt = kw.split(" ");
  for (let i = 0; i + kt.length <= tokens.length; i++)
    if (kt.every((w, j) => tokens[i + j] === w)) return true;
  return false;
}

/* The character file for an item name, or null before the manifest
 * has arrived (app.js charFor). */
export function charFor(name: unknown): string | null {
  if (!CHARM) return null;
  const tokens = tokensOf(name);
  for (const r of CHARM.items || []) if (r.char && (r.keywords || []).some(k => charMatch(tokens, k))) return r.char;
  for (const c of CHARM.categories || []) if (c.char && (c.keywords || []).some(k => charMatch(tokens, k))) return c.char;
  return CHARM.fallback || null;
}

/* Always a file: the basket stands in until the manifest has arrived
 * (quest.js qFaceFor). */
export const faceFor = (name: unknown): string => charFor(name) || "basket.webp";

/* Re-renders the caller once the manifest has arrived ("faces arrive late"). */
export function useCharacters(): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (CHARM) return;
    let live = true;
    loadCharacters().then(() => { if (live && CHARM) tick(n => n + 1); });
    return () => { live = false; };
  }, []);
}
