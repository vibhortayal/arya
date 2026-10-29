/* The Quest game's data source in the Arya app: the user's own lists,
 * their stores, the crowd-built store map and the hunt session.
 *
 * - Lists come from the plan (GET /api/quest/plan + /api/lists): the
 *   unchecked list, as a whole ("Everything") and per named list.
 * - A store's look comes from its shared map (GET /api/storemap),
 *   one map per location ("name|store id"): only sections Arya has
 *   located there count (coverageOf below); the rest are fog or a
 *   labelled guess. Never a guess passed as fact. Another location of
 *   a chain Arya has walked (Trader Joe's) plays the chain's typical
 *   layout, labelled as such, with its shelves as "usually" hints.
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
type NamedList = { id: string; name: string; stores?: string[] };
type StoreRow = { id: string; name: string; street?: string; city?: string; state?: string };
type Coverage = { kind: MapKind; seen: string[]; typical?: string };
type MapSeg = { label: string; status: "unmapped" | "mapped" | "aging" | "stale"; located?: boolean; has_photo?: boolean };
type SessItem = { name: string; shelf_label?: string | null };
export type Session = { id: string; store: string; store_id?: string | null; state: string; items: SessItem[]; mode: string };

const BASE = ["produce", "bakery", "deli", "meat", "dairy", "frozen"];

/* Which template section a store-map label means: "Aisle 3", "Produce
 * wall", "Frozen", "Pasta & Rice". Unknown labels map to nothing. */
const LABEL_WORDS: [RegExp, string][] = [
  [/peanut butter|almond butter/, "aisle3"],
  [/frozen|ice cream/, "frozen"],
  [/fish|seafood|butcher|meat/, "meat"],
  [/bread|bake/, "bakery"],
  [/milk|egg|cheese|yogurt|butter|dairy/, "dairy"],
  [/dip|hummus|deli|prepared/, "deli"],
  [/personal care|soap|shampoo|paper|household|clean|detergent|tissue/, "aisle4"],
  [/canned|condiment|sauce|dressing|oil|vinegar|pasta|rice|olive|soup|spice/, "aisle2"],
  [/peanut butter|jam|cereal|nut|dried fruit|coffee|tea|honey/, "aisle3"],
  [/snack|chip|cookie|cracker|drink|soda|juice|water|candy/, "aisle1"],
  [/produce|fruit|veg|salad|greens/, "produce"],
];
export function sectionOfLabel(label: string): string | null {
  const l = label.toLowerCase();
  const n = l.match(/aisle\s*(\d+)/);
  if (n) { const k = +n[1]; return k >= 1 && k <= 4 ? `aisle${k}` : null; }
  for (const [re, id] of LABEL_WORDS) if (re.test(l)) return id;
  for (const id of BASE) if (l.includes(id)) return id;
  return null;
}

/* How much of a store Arya has really located (owner, 2026-10-29:
 * "mapped" is earned, never granted by an upload). A segment counts
 * only when the server says it is located: a usable, non-stale
 * picture of it (a shopper's capture that was not weak, or a frame of
 * a shipped walk). Located segments are read as store sections, and:
 *   mapped     8 or more of the 10 sections located
 *   part mapped 3 to 7 located (the rest is fog until someone sees it)
 *   simulated  fewer than 3: one video or a few photos do not make a
 *              map; the store plays as a labelled guess. */
export const MAPPED_AT = 8, PART_AT = 3;
export function coverageOf(segs: MapSeg[]): { kind: MapKind; seen: string[] } {
  const out = new Set<string>();
  for (const s of segs) {
    const ok = s.located ?? ((s.status === "mapped" || s.status === "aging") && !!s.has_photo);
    const id = ok ? sectionOfLabel(s.label) : null;
    if (id) out.add(id);
  }
  const seen = [...out];
  const kind: MapKind = seen.length >= MAPPED_AT ? "mapped" : seen.length >= PART_AT ? "partial" : "simulated";
  return { kind, seen };
}

/* What the shared map says about a store: the sections located. */
export function mappedSections(segs: MapSeg[]): string[] {
  return coverageOf(segs).seen;
}

/* "Rice & Olives Shelf" -> "Near the Rice & Olives shelf" (never "Shelf shelf"). */
const shelfWord = (label: string) => label.replace(/\s+shel(f|ves)\s*$/i, "");
export const shelfHint = (label: string) => `Near the ${shelfWord(label)} shelf`;
/* At a location nobody mapped, the chain's shelf is only what is usual. */
export const typicalHint = (label: string, chain: string) => `Usually near the ${shelfWord(label)} shelf at ${chain}`;

/* The store map's address: one map per location when the id is known. */
export const mapRef = (name: string, id?: string) => (id ? `${name}|${id}` : name);

/* The line under a store in the list. */
export function seenLine(c: Coverage): string {
  const n = c.seen.length;
  if (c.kind !== "simulated") return `${n} of ${SECTIONS.length} sections located`;
  if (c.typical) return `Typical ${c.typical} layout · not mapped here yet`;
  return n ? "Not enough of it located yet" : "Nobody has mapped it yet";
}

const area = (s: StoreRow) => [s.street, s.city].filter(Boolean).join(" · ") || "";

export class AppSource implements QuestSource {
  private stores = new Map<string, StoreRow>();
  private seen = new Map<string, Coverage>();
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
      if (its.length) out.push({ id: l.id, name: l.name, items: its.map(item), ...(l.stores?.[0] ? { store: l.stores[0] } : {}) });
    }
    return out;
  }

  private async mapOf(ref: string): Promise<Coverage> {
    const hit = this.seen.get(ref); if (hit) return hit;
    const m = await get<{ segments: MapSeg[]; typical?: string | null }>(`/api/storemap?store=${encodeURIComponent(ref)}`).catch(() => ({ segments: [] as MapSeg[], typical: null }));
    const cov: Coverage = { ...coverageOf(m.segments || []), ...(m.typical ? { typical: m.typical } : {}) };
    this.seen.set(ref, cov);
    return cov;
  }

  private async summaries(rows: StoreRow[]): Promise<StoreSummary[]> {
    rows.forEach(r => this.stores.set(r.id, r));
    const mine = await this.maps().catch(() => [] as SavedMap[]);
    return Promise.all(rows.map(async r => {
      if (mine.some(m => m.key === `store:${r.id}`)) return { id: r.id, name: r.name, area: area(r), kind: "mapped" as MapKind, seen: "Your map" };
      const cov = await this.mapOf(mapRef(r.name, r.id));
      return { id: r.id, name: r.name, area: area(r), kind: cov.kind, seen: seenLine(cov) };
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
    // A trip with nothing on it is never created (owner 2026-10-29: an
    // empty quest sat on Your trips as "your next action").
    if (!list.items.length) throw new Error("empty list");
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
    const cov: Coverage = own ? { kind: "mapped", seen: own.zones.map(z => z.id) } : await this.mapOf(mapRef(name, st ? storeId : undefined));
    const ids = cov.kind === "simulated" ? [] : cov.seen, kind = cov.kind;
    const typical = kind === "simulated" ? cov.typical : undefined;
    const items: QuestItem[] = base.map(b => {
      const label = shelf.get(b.name.toLowerCase());
      // A shelf the store's walk matched is a real hint, only where the section is real;
      // at another location of the chain it is only what is usual there.
      if (label && ids.includes(b.section)) return { ...b, spot: { hint: shelfHint(label) } };
      if (label && typical) return { ...b, spot: { hint: typicalHint(label, typical) } };
      return b;
    });
    const layout = buildLayout({ id: storeId, name, area: own ? "Your map" : st ? area(st) : "", kind, items, mapped: ids, graph: own, typicalOf: typical });
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
        if (sec) await post("/api/storemap/segments", { store: mapRef(s.store, s.store_id || undefined), label: sec.short, side: "both" });
      }
    } catch { /* a report never blocks play */ }
  }

  progress(e: { kind: "grab" | "ungrab"; item: string; instead?: string }) {
    const s = this.sess; if (!s) return;
    void post(`/api/quest/sessions/${s.id}/check`, { item: e.item, checked: e.kind === "grab", ...(e.instead ? { instead: e.instead } : {}) }).catch(() => {});
  }

  async end(): Promise<void> {
    const s = this.sess; if (!s) return;
    this.sess = null;
    await post(`/api/quest/sessions/${s.id}/state`, { state: "abandoned" }).catch(() => {});
  }

  async finish(): Promise<void> {
    const s = this.sess; if (!s) return;
    try { this.sess = await post<Session>(`/api/quest/sessions/${s.id}/state`, { state: "finished" }); } catch { /* the receipt step can still close it */ }
  }
}
