/* The Quest game's data source in the Arya app: the user's own lists,
 * their stores, the crowd-built store map and the hunt session.
 *
 * - Lists come from the plan (GET /api/quest/plan + /api/lists): the
 *   unchecked list, as a whole ("Everything") and per named list.
 * - A store's look comes from its shared map (GET /api/storemap):
 *   sections seen by shoppers are real, the rest fog; a store nobody
 *   mapped is a labelled simulated store. Never a guess passed as fact.
 * - A real trip is a hunt session (POST /api/quest/sessions), so
 *   grabs check items off, "not here" files the existing shortage
 *   report, and the receipt step settles it like any hunt.
 * Practice never reaches this file (the game uses its silent source). */
import { get, post } from "../../lib/api";
import { charFor, loadCharacters } from "../../lib/characters";
import { artFor, type FieldReport, type QuestSource } from "../../game/core/source";
import { buildLayout, sectionFor, SECTIONS } from "../../game/core/template";
import type { MapKind, QuestItem, ShoppingList, StoreSummary } from "../../game/core/types";

type PlanRow = { name: string; qty?: number; list?: string | null };
type NamedList = { id: string; name: string };
type StoreRow = { id: string; name: string; street?: string; city?: string; state?: string };
type MapSeg = { label: string; status: "unmapped" | "mapped" | "aging" | "stale" };
type SessItem = { name: string; shelf_label?: string | null };
export type Session = { id: string; store: string; state: string; items: SessItem[]; mode: string };

const BASE = ["produce", "bakery", "deli", "meat", "dairy", "frozen"];

/* Which template section a store-map label means: "Aisle 3", "Produce
 * wall", "Frozen", "Pasta & Rice". Unknown labels map to nothing. */
export function sectionOfLabel(label: string): string | null {
  const l = label.toLowerCase();
  const n = l.match(/aisle\s*(\d+)/);
  if (n) { const k = +n[1]; return k >= 1 && k <= 4 ? `aisle${k}` : null; }
  for (const id of BASE) if (l.includes(id)) return id;
  if (/fish|seafood|butcher/.test(l)) return "meat";
  if (/bread|bake/.test(l)) return "bakery";
  if (/fruit|veg/.test(l)) return "produce";
  if (/milk|egg|cheese|yogurt/.test(l)) return "dairy";
  const s = sectionFor(l);
  return s !== "aisle1" || /snack|drink|chip|soda|juice|water|cookie|cracker/.test(l) ? s : null;
}

/* What the shared map says about a store: sections shoppers have seen
 * (mapped or aging; stale ones went back to fog). */
export function mappedSections(segs: MapSeg[]): string[] {
  const out = new Set<string>();
  for (const s of segs) if (s.status === "mapped" || s.status === "aging") { const id = sectionOfLabel(s.label); if (id) out.add(id); }
  return [...out];
}

export function kindFor(mapped: string[], need: string[]): MapKind {
  if (!mapped.length) return "simulated";
  return need.every(id => mapped.includes(id)) ? "mapped" : "partial";
}

/* "Rice & Olives Shelf" -> "Near the Rice & Olives shelf" (never "Shelf shelf"). */
export const shelfHint = (label: string) => `Near the ${label.replace(/\s+shel(f|ves)\s*$/i, "")} shelf`;

const area = (s: StoreRow) => [s.street, s.city].filter(Boolean).join(" · ") || "";

export class AppSource implements QuestSource {
  private stores = new Map<string, StoreRow>();
  private maps = new Map<string, string[]>();
  private sess: Session | null = null;

  /* The live hunt, for the receipt step. */
  session() { return this.sess; }

  async lists(): Promise<ShoppingList[]> {
    await loadCharacters();
    const [plan, named] = await Promise.all([
      get<{ list: PlanRow[] }>("/api/quest/plan"),
      get<{ lists: NamedList[] }>("/api/lists").catch(() => ({ lists: [] as NamedList[] })),
    ]);
    const item = (r: PlanRow) => ({ name: r.name, art: charFor(r.name) || artFor(r.name) });
    const rows = (plan.list || []).filter(r => r.name);
    const out: ShoppingList[] = [{ id: "all", name: "Everything", items: rows.map(item) }];
    for (const l of named.lists || []) {
      const its = rows.filter(r => r.list === l.id);
      if (its.length) out.push({ id: l.id, name: l.name, items: its.map(item) });
    }
    return out;
  }

  private async mapOf(name: string): Promise<string[]> {
    const hit = this.maps.get(name); if (hit) return hit;
    const m = await get<{ segments: MapSeg[] }>(`/api/storemap?store=${encodeURIComponent(name)}`).catch(() => ({ segments: [] as MapSeg[] }));
    const ids = mappedSections(m.segments || []);
    this.maps.set(name, ids);
    return ids;
  }

  private async summaries(rows: StoreRow[]): Promise<StoreSummary[]> {
    rows.forEach(r => this.stores.set(r.id, r));
    return Promise.all(rows.map(async r => {
      const ids = await this.mapOf(r.name);
      const kind = kindFor(ids, SECTIONS.map(s => s.id));
      const seen = ids.length ? `${ids.length} of ${SECTIONS.length} sections seen by shoppers` : "Nobody has mapped it yet";
      return { id: r.id, name: r.name, area: area(r), kind, seen };
    }));
  }

  async nearbyStores(): Promise<StoreSummary[]> {
    const r = await get<{ stores: StoreRow[] }>("/api/stores/mine").catch(() => ({ stores: [] as StoreRow[] }));
    return this.summaries((r.stores || []).slice(0, 12));
  }

  async findStores(q: string): Promise<StoreSummary[]> {
    const r = await get<{ stores: StoreRow[] }>(`/api/stores/search?q=${encodeURIComponent(q)}`);
    return this.summaries((r.stores || []).slice(0, 8));
  }

  async open(storeId: string, list: ShoppingList): Promise<{ layout: ReturnType<typeof buildLayout>; items: QuestItem[] }> {
    const st = this.stores.get(storeId);
    const name = st?.name || storeId;
    this.sess = await post<Session>("/api/quest/sessions", { store_id: st ? storeId : undefined, store: name, mode: "quest", items: list.items.map(i => ({ name: i.name })) });
    void post(`/api/quest/sessions/${this.sess.id}/state`, { state: "playing" }).catch(() => {});
    const shelf = new Map(this.sess.items.map(i => [i.name.toLowerCase(), i.shelf_label]));
    const base = list.items.map((it, i) => ({ key: `${i}-${it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: it.name, art: it.art || artFor(it.name), section: sectionFor(it.name) }));
    const ids = await this.mapOf(name);
    const kind = kindFor(ids, [...new Set(base.map(b => b.section))]);
    const items: QuestItem[] = base.map(b => {
      const label = shelf.get(b.name.toLowerCase());
      // A shelf the store's walk matched is a real hint, only where the section is real.
      return label && kind !== "simulated" && (kind === "mapped" || ids.includes(b.section)) ? { ...b, spot: { hint: shelfHint(label) } } : b;
    });
    const layout = buildLayout({ id: storeId, name, area: st ? area(st) : "", kind, items, mapped: ids });
    return { layout, items };
  }

  async report(r: FieldReport): Promise<void> {
    const s = this.sess; if (!s) return;
    try {
      if (r.kind === "empty" || r.kind === "elsewhere") {
        await post(`/api/quest/sessions/${s.id}/report-missing`, { item: r.item, kind: r.kind === "empty" ? "empty_shelf" : "wrong_aisle" });
      } else if (r.kind === "found") {
        // Fog cleared: make sure the section is on the store's map, so the next capture prompt can ask for it.
        const sec = SECTIONS.find(x => x.id === r.section);
        if (sec) await post("/api/storemap/segments", { store: s.store, label: sec.short, side: "both" });
      }
    } catch { /* a report never blocks play */ }
  }

  progress(e: { kind: "grab" | "ungrab"; item: string }) {
    const s = this.sess; if (!s) return;
    void post(`/api/quest/sessions/${s.id}/check`, { item: e.item, checked: e.kind === "grab" }).catch(() => {});
  }

  async finish(): Promise<void> {
    const s = this.sess; if (!s) return;
    try { this.sess = await post<Session>(`/api/quest/sessions/${s.id}/state`, { state: "finished" }); } catch { /* the receipt step can still close it */ }
  }
}
