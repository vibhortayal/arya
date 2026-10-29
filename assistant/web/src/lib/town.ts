import { useEffect, useSyncExternalStore } from "react";
import { get, post } from "./api";
import { useSession } from "../app/session";

/* Demo Town (api/town.py): the demo household's simulated
 * neighbourhood. One payload with the stores, the list items' stock
 * and the "Near you today" lines. Off (null) for a real account and
 * when the server flag is off: the server answers 404 and we stop
 * asking. Everything it carries is simulated and labelled so. */

export type TownStore = {
  name: string; status: "open" | "shut" | "closed" | "incident"; busy: "quiet" | "busy" | "packed";
  closes: number; why: string; households: number; ago_min: number;
};
export type TownItemStore = {
  state: "in" | "out" | "none"; households: number; ago_min: number; pending: number; price: number | null; mine: boolean;
};
export type TownAlt = { store: string; price: number | null; households: number };
export type TownItem = { key: string; name: string; stores: Record<string, TownItemStore>; alt: TownAlt | null };
export type TownLine = {
  kind: "out" | "closed" | "incident" | "quiet" | "rush" | "price"; store: string; item?: string;
  households?: number; ago_min?: number; why?: string; alt?: TownAlt | null; price?: number;
};
export type Town = {
  label: string; neighbours: number; stores: Record<string, TownStore>; items: Record<string, TownItem>;
  feed: TownLine[]; alternatives: Record<string, string>;
};

let town: Town | null = null;
let off = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (t: Town | null) => { town = t; listeners.forEach(f => f()); };

export function refreshTown(): Promise<void> {
  if (off) return Promise.resolve();
  if (pending) return pending;
  pending = get<Town>("/api/town/hints")
    .then(set, () => { off = true; set(null); })
    .finally(() => { pending = null; });
  return pending;
}

/* The town for this screen, or null. Refreshes once per mount so the
 * ages ("40 min ago") and staged moments are current. */
export function useTown(): Town | null {
  const { demo } = useSession();
  useEffect(() => { if (demo) void refreshTown(); }, [demo]);
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => (demo ? town : null));
}

export const townReport = (kind: "out" | "in" | "closed" | "incident", store: string, item = "") =>
  post<Town>("/api/town/report", { kind, store, item }).then(set);

export const townDirector = (scenario: string) => post<Town>("/api/town/director", { scenario }).then(set);

/* The Director is for the person staging the demo: open the app with
 * ?director=1 once and it stays for this tab. */
export function directorOn(): boolean {
  try {
    if (new URLSearchParams(location.search).get("director") === "1") sessionStorage.setItem("arya-director", "1");
    return sessionStorage.getItem("arya-director") === "1";
  } catch { return false; }
}
