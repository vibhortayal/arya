/* Kroger aisle hints for one shopping trip. Fetched in the background
 * when the trip opens, held in this component's memory only, gone when
 * the trip screen closes (checkout or leaving). Never written to the
 * saved trip, a map or storage. A slow or failed fetch is silent: the
 * screen simply has no hint line. */
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type KrogerHint = { product?: string; department?: string; aisle?: string; side?: string; bay?: string; shelf?: string };
export type KrogerHints = Record<string, KrogerHint>;

const SIDE: Record<string, string> = { L: "left side", R: "right side" };

/* "Aisle 2 · left side · bay 10". Values come from Kroger as sent; only
 * the side code is spelled out. */
export function formatHint(h: KrogerHint): string {
  const where = h.aisle ? `Aisle ${h.aisle}` : (h.department || "");
  const parts = [where, h.side ? (SIDE[h.side] || h.side) : "", h.bay ? `bay ${h.bay}` : ""].filter(Boolean);
  return parts.join(" · ");
}

const key = (name: string) => name.trim().toLowerCase();

/* Hints by lower-cased item name. enabled=false (practice trips) never
 * calls the server. Items added mid-trip are fetched when they appear. */
export function useKrogerHints(storeId: string, names: string[], enabled: boolean): KrogerHints {
  const [hints, setHints] = useState<KrogerHints>({});
  const asked = useRef(new Set<string>());
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  const want = names.filter(n => n.trim() && !asked.current.has(key(n)));
  const sig = want.map(key).join("|");
  useEffect(() => {
    if (!enabled || !storeId || !want.length) return;
    want.forEach(n => asked.current.add(key(n)));
    api<{ enabled?: boolean; hints?: Record<string, KrogerHint> }>("/api/stores/kroger-trip", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, items: want }),
    }).then(r => {
      if (gone.current || !r?.hints) return;
      const add: KrogerHints = {};
      for (const [name, h] of Object.entries(r.hints)) add[key(name)] = h;
      if (Object.keys(add).length) setHints(prev => ({ ...prev, ...add }));
    }).catch(() => { /* no hint is the fallback */ });
  }, [storeId, enabled, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return hints;
}

export const hintFor = (hints: KrogerHints, name: string): string => {
  const h = hints[key(name)];
  return h ? formatHint(h) : "";
};
