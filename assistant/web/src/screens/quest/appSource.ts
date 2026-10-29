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
 * - Build: Arya adapts a store made from three answers
 *   (POST /api/quest/build), changes it from a sentence, and saves it
 *   (PUT /api/quest/maps). A saved My map is the store's shape from
 *   then on, for this player only.
 * Practice never reaches this file (the game uses its silent source). */
import { get, post, put } from "../../lib/api";
import { startCapture, transcribeBlob, voiceSupported } from "../../lib/recorder";
import { charFor, loadCharacters } from "../../lib/characters";
import { artFor, type FieldReport, type QuestSource, type SavedMap } from "../../game/core/source";
import { buildLayout, sectionFor, SECTIONS } from "../../game/core/template";
import { TEMPLATE, type StoreGraph } from "../../game/map/graph";
import { knownZone } from "../../game/map/classify";
import type { Answers } from "../../game/map/answers";
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
  private seen = new Map<string, string[]>();
  private sess: Session | null = null;
  private saved: SavedMap[] | null = null;

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
    const hit = this.seen.get(name); if (hit) return hit;
    const m = await get<{ segments: MapSeg[] }>(`/api/storemap?store=${encodeURIComponent(name)}`).catch(() => ({ segments: [] as MapSeg[] }));
    const ids = mappedSections(m.segments || []);
    this.seen.set(name, ids);
    return ids;
  }

  private async summaries(rows: StoreRow[]): Promise<StoreSummary[]> {
    rows.forEach(r => this.stores.set(r.id, r));
    const mine = await this.maps().catch(() => [] as SavedMap[]);
    return Promise.all(rows.map(async r => {
      if (mine.some(m => m.key === `store:${r.id}`)) return { id: r.id, name: r.name, area: area(r), kind: "mapped" as MapKind, seen: "Your map" };
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

  /* Items the words do not know go to Arya (one Spark call, cached per
   * item); anything it cannot place keeps its word guess. */
  private async zonesFor(names: string[], g: StoreGraph): Promise<Record<string, string>> {
    const unknown = names.filter(n => !knownZone(n, g));
    if (!unknown.length) return {};
    const zones = g.zones.map(z => ({ id: z.id, label: z.label, categories: (z.categories || []).slice(0, 8) }));
    const r = await post<{ zones: Record<string, string> }>("/api/quest/zones", { graph: g.id, items: unknown, zones }).catch(() => ({ zones: {} }));
    return r.zones || {};
  }

  async open(storeId: string, list: ShoppingList): Promise<{ layout: ReturnType<typeof buildLayout>; items: QuestItem[] }> {
    const st = this.stores.get(storeId);
    const name = st?.name || storeId;
    // The player's own map of this store, if they built one: its zones are the store's shape.
    const own = (await this.maps().catch(() => [] as SavedMap[])).find(m => m.key === `store:${storeId}`)?.graph;
    const [sess, zoned] = await Promise.all([
      post<Session>("/api/quest/sessions", { store_id: st ? storeId : undefined, store: name, mode: "quest", items: list.items.map(i => ({ name: i.name })) }),
      this.zonesFor(list.items.map(i => i.name), own || TEMPLATE),
    ]);
    this.sess = sess;
    void post(`/api/quest/sessions/${this.sess.id}/state`, { state: "playing" }).catch(() => {});
    const shelf = new Map(this.sess.items.map(i => [i.name.toLowerCase(), i.shelf_label]));
    const base = list.items.map((it, i) => ({ key: `${i}-${it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: it.name, art: it.art || artFor(it.name), section: zoned[it.name] || sectionFor(it.name, own) }));
    const ids = own ? own.zones.map(z => z.id) : await this.mapOf(name);
    const kind = own ? "mapped" : kindFor(ids, [...new Set(base.map(b => b.section))]);
    const items: QuestItem[] = base.map(b => {
      const label = shelf.get(b.name.toLowerCase());
      // A shelf the store's walk matched is a real hint, only where the section is real.
      return label && kind !== "simulated" && (kind === "mapped" || ids.includes(b.section)) ? { ...b, spot: { hint: shelfHint(label) } } : b;
    });
    const layout = buildLayout({ id: storeId, name, area: own ? "Your map" : st ? area(st) : "", kind, items, mapped: ids, graph: own });
    return { layout, items };
  }

  async build(answers: Answers, base: StoreGraph): Promise<StoreGraph> {
    const r = await post<{ graph: StoreGraph }>("/api/quest/build", { answers, base });
    return r.graph || base;
  }

  async change(graph: StoreGraph, say: string): Promise<{ graph: StoreGraph; say: string }> {
    const r = await post<{ graph: StoreGraph; say: string }>("/api/quest/build/change", { graph, say });
    return { graph: r.graph || graph, say: r.say || "" };
  }

  async maps(): Promise<SavedMap[]> {
    if (!this.saved) this.saved = (await get<{ maps: SavedMap[] }>("/api/quest/maps")).maps || [];
    return this.saved;
  }

  async saveMap(m: Omit<SavedMap, "key" | "savedAt">): Promise<SavedMap> {
    const row = await put<SavedMap>("/api/quest/maps", m);
    this.saved = [row, ...(this.saved || []).filter(x => x.key !== row.key)];
    return row;
  }

  async voice(): Promise<{ stop(): Promise<string>; cancel(): void }> {
    if (!voiceSupported()) throw new Error("no microphone");
    const cap = await startCapture();
    return { stop: () => transcribeBlob(cap.stop()), cancel: () => cap.cancel() };
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

  progress(e: { kind: "grab" | "ungrab"; item: string; instead?: string }) {
    const s = this.sess; if (!s) return;
    void post(`/api/quest/sessions/${s.id}/check`, { item: e.item, checked: e.kind === "grab", ...(e.instead ? { instead: e.instead } : {}) }).catch(() => {});
  }

  async finish(): Promise<void> {
    const s = this.sess; if (!s) return;
    try { this.sess = await post<Session>(`/api/quest/sessions/${s.id}/state`, { state: "finished" }); } catch { /* the receipt step can still close it */ }
  }
}
