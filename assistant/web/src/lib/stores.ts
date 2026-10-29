/* Which stores Arya holds aisle pictures for (pwa/storedata.js). The
 * server says (GET /api/storemap/stores): a shipped photo walk or 3D
 * model, or shopper captures kept on the store's shared map. Read
 * once per page load; the last answer is kept on the phone, and
 * Trader Joe's (shipped with the app) always works, also offline or
 * when the fetch fails. One place, so the store picker, the Start
 * shopping sheet and the session's driver agree.
 *
 * A store with no pictures offers Express only: Quest needs aisle
 * photos. An item "has data" when its store has pictures AND the
 * server placed the item on a shelf (shelf_u). */
import { useEffect, useSyncExternalStore } from "react";

export type StoreRow = { store: string; key: string; photos: string | null; model: string | null; has_pictures: boolean };

const BUILTIN: StoreRow[] = [
  { store: "Trader Joe's", key: "traderjoes", photos: "models/trader-joes/frames-web",
    model: "models/trader-joes/manifest.json", has_pictures: true },
];
const CACHE = "arya-store-data";

const squash = (store: unknown) => String(store || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

let rows: Record<string, StoreRow> = {};
let version = 0;
let loaded = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function setStoreRows(list: unknown) {
  const next: Record<string, StoreRow> = {};
  for (const r of [...BUILTIN, ...(Array.isArray(list) ? (list as StoreRow[]) : [])]) {
    if (r && r.key) next[r.key] = { ...next[r.key], ...r };
  }
  rows = next;
  version++;
  listeners.forEach(f => f());
}
try { setStoreRows(JSON.parse(localStorage.getItem(CACHE) || "[]")); } catch { setStoreRows([]); }

/* One fetch per page load; a failure (offline, signed out) keeps what
 * the phone already knows and tries again on the next call. */
export function loadStoreData(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (pending) return pending;
  if (typeof fetch !== "function") return Promise.resolve();
  pending = fetch("/api/storemap/stores", { credentials: "same-origin" })
    .then(r => (r.ok ? r.json() : null))
    .then(out => {
      if (out && Array.isArray(out.stores)) {
        setStoreRows(out.stores);
        loaded = true;
        try { localStorage.setItem(CACHE, JSON.stringify(out.stores)); } catch { /* private mode */ }
      }
    })
    .catch(() => {})
    .finally(() => { pending = null; });
  return pending;
}

/* Repaint a screen when the server's answer lands. */
export function useStoreData(): number {
  useEffect(() => { loadStoreData(); }, []);
  return useSyncExternalStore(
    f => { listeners.add(f); return () => { listeners.delete(f); }; },
    () => version);
}

const info = (store: unknown): StoreRow | null => rows[squash(store)] || null;
/* quest.js qStorePhotos: the store's photo-walk frames, or null. */
export const storePhotos = (store: unknown): string | null => info(store)?.photos || null;
/* quest.js qStoreModel: the store's 3D model manifest, or null. */
export const storeModel = (store: unknown): string | null => info(store)?.model || null;
/* A photo walk, a 3D model or captured aisle photos: Quest can run. */
export const storeHasPictures = (store: unknown): boolean => !!info(store)?.has_pictures;
/* The item can be shown: store pictures and a shelf match. */
export const itemHasData = (store: unknown, item: { shelf_u?: number | null } | null | undefined): boolean =>
  storeHasPictures(store) && !!item && item.shelf_u !== undefined && item.shelf_u !== null;
