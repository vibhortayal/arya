import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useBackHandler, useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { SuggestDrop, lastSegment, replaceLast, useSuggest } from "../ui/Suggest";
import { HeadsUp, StoreNotice, storeTrouble, TownChip, TownItemSheet } from "../ui/Town";
import { useTown } from "../lib/town";
import { decode, isPdfFile } from "../ui/AddReceiptSheet";
import { IconCheck, IconMic, IconMore, IconPen, IconSearch, IconSpark } from "../ui/icons";
import { get, post } from "../lib/api";
import { asset, fmtDate, keepUnit, lineSavings, money, qtyTag } from "../lib/format";
import { charFor, useCharacters } from "../lib/characters";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import { ListSheet, type SheetState, type StoreLink } from "./lists/ListSheets";
import { looksLikeAsk, parseAddToList, useAsk } from "./lists/AskCard";
import {
  alsoNames, askLaterHas, cache, itemHome, lensName, lensState, namedLists, onListItems, sameStore,
  suggestHome, suggestions, suggestWhy, type HomeData, type Item,
} from "./lists/model";
import { FIND_AT, groupByAisle, loadFolded, matchesFind, saveFolded } from "./lists/aisles";
import { autoMode, filterLists, markOpened, readMode, readOpened, readView, recentLists, viewMode, writeMode, writeView,
  type ListsMode, type ListsView } from "./lists/adaptive";
import { t, useTranslation } from "../i18n";
import { pickerProps } from "../ui/picker";
import { EditList, EditTitle } from "../ui/EditList";
import { arrange } from "../lib/layout";
import { fitPhoto } from "../lib/photo";

/* Port of pwa/index.html #view-list and the Lists half of pwa/app.js
 * (renderList, paintListsHome, paintListPage, the Start shopping sheet,
 * swipe / select / remove / quantity, the one-field composer with mic
 * and camera, Eyes sightings) with pwa/lists.js in lists/ListSheets.tsx
 * and pwa/aryaask.js in lists/AskCard.tsx. The Shell already renders
 * <section id="view-list">.
 *
 * Start shopping opens the Quest game on this list:
 * nav.show("community", { listId }) ("all" for Everything else).
 *
 * Local helpers kept here: the swipe / long-press wiring, the split
 * preview, the group line and the Eyes block. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cap = (h: string) => (h ? h.charAt(0).toUpperCase() + h.slice(1) : "");

/* ---------------- the add field's split preview (app.js bindAdd) ---------------- */

const ADD_LEAD = /^(please get |please buy |please add |add |buy |get |and |i need some |i need |we need some |we need |i want some |i want |get me some |get me )/i;
export function splitPreview(text: string): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const chunk of String(text || "").split(/[\n;]+/)) {
    const low = chunk.trim().toLowerCase();
    const sentence = chunk.includes(",") || ADD_LEAD.test(low) || (low.match(/ and /g) || []).length >= 2;
    let pieces = chunk.split(",");
    if (sentence) pieces = pieces.flatMap(p => p.split(/\s+and\s+/i));
    for (const piece of pieces) {
      let name = piece.replace(/^[\s•\-*☐☑✓\d.)]+/, "").trim();
      name = name.replace(/^(oh|okay|ok|so|well|um|uh|hmm)[,\s]+/i, "").replace(ADD_LEAD, "");
      if (/^(oh|okay|ok|so|well|um|uh|hmm)$/i.test(name)) name = "";
      if (name.toLowerCase().startsWith("some ")) name = name.slice(5);
      name = name.replace(/\s*[x×]\s*\d+\s*$/, "").replace(/[.!]+$/, "").trim();
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
    }
  }
  return out;
}

/* ---------------- what an add did, in words ----------------
 * The toast names the items, so an add that changed nothing on screen
 * still says why: back from Checked off, moved here from another list,
 * or already on a list (QA 2026-10-30). */

export type AddResult = { added: number; already?: number; skipped?: string[]; names?: string[];
  already_names?: { name: string; list: string }[]; back?: string[]; moved?: { name: string; from: string }[];
  also?: { name: string; item_id: string; list: string }[] };

const nameList = (ns: string[]) => (ns.length <= 3 ? ns.join(", ") : t("lists.namesAndMore", { names: ns.slice(0, 2).join(", "), n: ns.length - 2 }));

export function addToast(r: AddResult, where: string): string {
  const back = r.back || [], moved = r.moved || [], already = r.already_names || [], also = r.also || [];
  const other = new Set([...back, ...moved.map(m => m.name), ...already.map(a => a.name), ...also.map(a => a.name)]);
  const fresh = (r.names || []).filter(n => !other.has(n));
  const out: string[] = [];
  if (fresh.length) out.push(t("lists.addedNamesTo", { names: nameList(fresh), where }));
  if (back.length) out.push(t("lists.backOnList", { names: nameList(back), count: back.length }));
  for (const a of also) out.push(t("lists.addedAlsoOn", { name: a.name, list: a.list || t("common.everythingElse") }));
  for (const m of moved) out.push(m.from ? t("lists.movedHereFrom", { name: m.name, from: m.from }) : t("lists.movedHere", { name: m.name }));
  for (const a of already) out.push(t("lists.alreadyOnNamed", { name: a.name, where: a.list || t("common.everythingElse") }));
  if (!out.length && !r.added && (r.skipped || []).length) return t("lists.nothingAdded");
  if (!out.length) out.push(t("lists.addedNTo", { count: r.added, where }));
  const skip = (r.skipped || []).length ? t("lists.leftOut", { names: r.skipped!.join(", ") }) : "";
  return out.join(" ") + skip;
}

/* ---------------- the group line (group.js decorateLists) ---------------- */

type Member = { handle: string; me?: boolean; owner?: boolean };
type GState = { enabled?: boolean; group?: { name: string; members: Member[] } | null;
  recent?: Record<string, { by: string; action: string; name: string; at: number }> };

function ago(sec: number) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - sec));
  if (s < 90) return t("common.ago.justNow");
  if (s < 3600) return t("common.ago.minutes", { n: Math.round(s / 60) });
  if (s < 86400) return t("common.ago.hours", { n: Math.round(s / 3600) });
  return Math.round(s / 86400) === 1 ? t("common.ago.yesterday") : t("common.ago.days", { count: Math.round(s / 86400) });
}

/* ---------------- Eyes ---------------- */

type Sighting = { name: string; state: string; judge_agree?: boolean };
type EyesRec = { id: string; kind: string; date: string; sightings: Sighting[] };
/* A pantry photo's kind (api/routes/eyes.py) and a sighting's state
 * show as words, never the server's raw value (labels audit). */
const PHOTO_KINDS = ["fridge", "pantry", "freezer", "fruit"];
const SIGHTING_STATES = ["pending", "confirmed", "rejected"];
const sightingLine = (sg: Sighting) => (SIGHTING_STATES.includes(sg.state) ? t(`lists.sighting.${sg.state}`) : "");

/* ---------------- one list row ---------------- */

/* Typing in the composer re-renders the screen; a row whose item and
 * state did not change is skipped (speed audit #15). The callbacks it
 * gets are stable, and Demo Town's chip always redraws. */
const ListRow = memo(ListRowView, (a, b) => a.i === b.i && a.picking === b.picking && a.picked === b.picked
  && (a.also || []).join("|") === (b.also || []).join("|") && !a.chip && !b.chip
 );

function ListRowView({ i, picking, picked, chip, also }: { i: Item; picking: boolean; picked: boolean; also?: string[];
  chip?: ReactNode }) {
  const { t } = useTranslation();
  const sub = i.added_by ? t("lists.addedBy", { name: i.added_by }) : "";
  // Name and size are separate: "6 ct" or "x2" under a clean name (owner, 2026-10-31).
  const size = qtyTag(i);
  return (
    <div className="swipewrap" data-wrap-id={i.item_id}>
      <div className="acts" aria-hidden="true"><button type="button" className="mv" data-act="move" data-id={i.item_id} tabIndex={-1}>{t("lists.move")}</button><button type="button" className="rm" data-act="remove" data-id={i.item_id} tabIndex={-1}>{t("common.remove")}</button></div>
      <div className={"row listrow" + (i.checked ? " checked" : "") + (picked ? " picked" : "")} tabIndex={0} data-row-id={i.item_id}
        {...(picking ? { role: "checkbox", "aria-checked": picked } : {})}>
        {picking ? <span className="pick" data-act="pick" data-id={i.item_id}><IconCheck /></span>
          : <button className="check" type="button" data-act="check" data-id={i.item_id} aria-pressed={!!i.checked} aria-label={t(i.checked ? "lists.uncheck" : "lists.checkOff", { name: i.name })}><IconCheck /></button>}
        <div className="grow"><span className="name">{keepUnit(i.name)}</span>
          {size ? <span className="sub size">{size}</span> : null}
          {i.note ? <span className="sub note">{i.note}</span> : null}
          {sub ? <span className="sub">{sub}</span> : null}
          {also && also.length ? <span className="sub alsoon">{t("lists.alsoOn", { lists: also.join(", ") })}</span> : null}
          {chip ? <span className="sub">{chip}</span> : null}
          {askLaterHas(i.name) ? <span className="sub asklater">{t("lists.toAskKeptAsTyped")}</span> : null}
          {i.not_grocery && !picking ? <span className="sub notgrocery">{t("lists.notAGroceryItemAdded")}{" "}<button className="linkbtn" type="button" data-act="ng-keep" data-id={i.item_id}>{t("lists.itIsGroceries")}</button> · <button className="linkbtn" type="button" data-act="ng-remove" data-id={i.item_id}>{t("common.remove")}</button></span> : null}</div>
        {picking ? null : <button className="morebtn" type="button" data-act="more" data-id={i.item_id} aria-label={t("lists.moreFor", { name: i.name })}><IconMore /></button>}
      </div>
    </div>
  );
}

/* ---------------- first run (#163) ----------------
 * An account with no named lists, nothing on a list and nothing
 * suggested sees one card (the basket and Create your first list) in
 * place of Everything else and the New list button (owner,
 * 2026-10-29). Once anything exists the screen is as before. */
export function listsEmpty(data: HomeData | null): boolean {
  return !!data && !namedLists(data).length && !onListItems(data).length && !suggestions(data).length;
}
/* Owner 2026-10-29: new accounts see the bare card (image and button).
 * true adds the title back. The one-line explanation shows either way
 * (owner approved the mockup, 2026-10-30). */
const EMPTY_CARD_TEXT = false;

/* ---------------- the screen ---------------- */

type InCard =
  | { kind: "item"; name: string; sure: boolean; url?: string }
  | { kind: "unclear"; title: string; body: string; retry: "photo" | "mic"; url?: string };

export function Lists() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const avatar = useAvatar().src;
  const { user, demo, shopMode, saveShopMode, patchShop, layouts = {}, saveLayout } = useSession();
  // Edit mode on Lists (card library, 2026-10-30): order, hide, and
  // what each list shows.
  const [editing, setEditing] = useState(false);
  useCharacters();

  const [data, setData] = useState<HomeData | null>(cache.data);
  const [loadFailed, setLoadFailed] = useState(false);
  /* Who sees the receipts, for the Receipts row: you alone, or you and your group. */
  const [groupName, setGroupName] = useState<string | null>(null);
  useEffect(() => {
    get<{ group: { name: string } | null }>("/api/group").then(g => { if (alive.current) setGroupName(g?.group?.name || null); }, () => {});
  }, []);
  const dataRef = useRef<HomeData | null>(cache.data);
  // Today's list cards open one list (app.js: listLens = card's id).
  const [lens, setLensState] = useState(() => {
    const want = nav.params.lens;
    if (typeof want === "string" && want) lensState.lens = want;
    if (nav.params.newList) lensState.lens = "home";
    return lensState.lens;
  });
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [find, setFind] = useState("");
  const [finding, setFinding] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(loadFolded);
  const toggleFold = (key: string) => setFolded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    saveFolded(next);
    return next;
  });
  // Today's Get started step 1 opens the new-list sheet (once).
  // Step 2 (Pick your store) opens that list's store picker.
  const [sheet, setSheet] = useState<SheetState | null>(() => (nav.params.newList ? { kind: "new", moving: null }
    : nav.params.stores ? { kind: "stores" } : null));
  // Back to this entry must not open it again.
  useEffect(() => { nav.params.newList = undefined; nav.params.stores = undefined; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [shopOpen, setShopOpen] = useState(false);
  // Just my list (8): the list itself turns into the shopping view. One
  // list at a time, kept for the browser session.
  const [shopping, setShoppingId] = useState<string | null>(() => { try { return sessionStorage.getItem("arya.shopping"); } catch { return null; } });
  const setShopping = (id: string | null) => {
    setShoppingId(id);
    try { if (id) sessionStorage.setItem("arya.shopping", id); else sessionStorage.removeItem("arya.shopping"); } catch { /* private window */ }
  };
  const [doneStep, setDoneStep] = useState<"ask" | "clear" | null>(null);
  const town = useTown();
  const [townItem, setTownItem] = useState<string | null>(null);
  const [g, setG] = useState<GState>({ enabled: false, group: null, recent: {} });
  const [eyes, setEyes] = useState<EyesRec[]>([]);
  // The adaptive home (#156): the last automatic mode for this account,
  // the device's Cards | List choice, and the search text.
  const lastMode = useRef<ListsMode | null>(readMode(user));
  const [view, setView] = useState<ListsView | null>(readView);
  const [query, setQuery] = useState("");

  const [text, setText] = useState("");
  const textRef = useRef("");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  const [listening, setListening] = useState(false);
  const capture = useRef<Capture | null>(null);
  /* What Arya understood from a photo or voice, or why it could not tell:
   * a card under the add box, never a silent miss. The photo thumbnail stays
   * until the card is dismissed so Try again and Edit lose nothing. */
  const [inCard, setInCard] = useState<InCard | null>(null);
  const closeCard = () => setInCard(c => { if (c && c.url) URL.revokeObjectURL(c.url); return null; });
  const failCard = (title: string, body: string, retry: "photo" | "mic", file?: File) =>
    setInCard({ kind: "unclear", title, body, retry, url: file ? URL.createObjectURL(file) : undefined });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const smart = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; capture.current?.cancel(); document.body.classList.remove("selecting"); }, []);

  // The entry's params follow the lens, so Back from an item page
  // returns to the list that was open, not the card that opened Lists.
  const setLens = (id: string) => { lensState.lens = id; if (nav.params.lens !== undefined) nav.params.lens = id; setLensState(id); };
  const guard = (fn: () => Promise<void>) => { fn().catch(e => toast(errMsg(e))); };

  /* ---- data ---- */
  const loadGroup = useCallback(async () => {
    let r: GState;
    try { r = await get<GState>("/api/group"); } catch { r = { enabled: false, group: null, recent: {} }; }
    if (alive.current) setG({ ...r, recent: r.recent || {} });
  }, []);
  const reload = useCallback(async (): Promise<HomeData> => {
    const h = await get<HomeData>("/api/home");
    cache.data = h; dataRef.current = h;
    if (alive.current) { setData(h); setLoadFailed(false); }
    loadGroup();
    return h;
  }, [loadGroup]);
  const reloadQuiet = useCallback(() => { reload().catch(showErr); }, [reload, showErr]);
  /* Optimistic taps (speed audit #1, #26): a tick, remove or quantity
   * change shows at once, the POST goes behind it, and one quiet
   * reload follows once the taps stop and every write is back. A
   * failed write rolls back and says so. */
  const pending = useRef(0);
  const settle = useRef<number | undefined>(undefined);
  const reconcile = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      if (pending.current > 0) { reconcile(); return; }
      reload().then(() => { if (alive.current) setGone(new Set()); }).catch(showErr);
    }, 900);
  }, [reload, showErr]);
  useEffect(() => () => clearTimeout(settle.current), []);
  const patch = (fn: (i: Item) => Item | null, id: string) => {
    const d = dataRef.current;
    if (!d) return;
    const next: HomeData = { ...d, list: { ...d.list, items: d.list.items.map(i => (i.item_id === id ? fn(i) || i : i)) } };
    cache.data = next; dataRef.current = next;
    if (alive.current) setData(next);
  };
  // Writes for one item go out in order, so a fast double tap ends in
  // the state the second tap asked for.
  const chain = useRef(new Map<string, Promise<unknown>>());
  const write = (id: string, fn: () => Promise<unknown>) => {
    pending.current++;
    const run = (chain.current.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    chain.current.set(id, run);
    return run.finally(() => { pending.current--; if (chain.current.get(id) === run) chain.current.delete(id); reconcile(); });
  };
  // A row just ticked stays in place, filled and struck through, for a
  // moment before it slides into Checked off.
  const [hold, setHold] = useState<Set<string>>(new Set());
  // Rows removed here but not yet confirmed by a reload ("id|list").
  const [gone, setGone] = useState<Set<string>>(new Set());
  const loadEyes = useCallback(async () => {
    const r = await get<{ records: EyesRec[] }>("/api/eyes").catch(() => ({ records: [] as EyesRec[] }));
    if (alive.current) setEyes(r.records || []);
  }, []);

  useEffect(() => { reload().catch(e => { if (alive.current) setLoadFailed(true); showErr(e); }); loadEyes(); }, [reload, loadEyes, showErr]);

  // Group live sync refreshes the list in place (#3).
  useEffect(() => {
    const onLive = (ev: Event) => { ev.preventDefault(); reconcile(); };
    window.addEventListener("arya-live", onLive);
    return () => window.removeEventListener("arya-live", onLive);
  }, [reconcile]);

  const ask = useAsk(reloadQuiet);

  /* ---- derived ---- */
  const lists = namedLists(data);
  const lay = layouts.lists || {};
  const arranged = arrange(lists.map(l => l.id), lay.order, lay.hidden);
  const homeLists = arranged.shown.map(id => lists.find(l => l.id === id)!);
  const flags = new Set(lay.flags || []);
  function saveListsLayout(v: typeof lay, msg?: string) {
    const prev = layouts.lists || {};
    saveLayout("lists", v).catch(showErr);
    if (msg) toast(msg, { action: t("common.undo"), onAction: () => { saveLayout("lists", prev).catch(showErr); } });
  }
  // A lens whose list is gone falls back to the cards.
  const effLens = data && lens !== "home" && lens !== "else" && !lists.some(l => l.id === lens) ? "home" : lens;
  const here = lists.find(l => l.id === effLens) || null;
  const lid = here ? here.id : "else";
  const name = data ? lensName(data, lid) : "";
  const rows = data ? onListItems(data).filter(i => itemHome(data, i) === lid && !gone.has(i.item_id + "|" + lid)) : [];
  const open = rows.filter(i => !i.checked || hold.has(i.item_id)), done = rows.filter(i => i.checked && !hold.has(i.item_id));
  const groceries = open.filter(i => !i.not_grocery), errands = open.filter(i => i.not_grocery);
  /* A long list gets a find field (25+ open items) and department
   * headers (12+), owner 2026-10-30. A search shows a flat result. */
  const findOn = open.length >= FIND_AT;
  const q = findOn && finding ? find.trim() : "";
  useEffect(() => { setFinding(false); setFind(""); }, [findOn, lid]);
  const gShown = q ? groceries.filter(i => matchesFind(i, q)) : groceries;
  const eShown = q ? errands.filter(i => matchesFind(i, q)) : errands;
  const aisleGroups = q ? null : groupByAisle(groceries);
  const selEff = useMemo(() => (sel ? new Set([...sel].filter(x => open.some(i => i.item_id === x))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, data, effLens]);
  const selRef = useRef<Set<string> | null>(null);
  selRef.current = selEff;
  const onPage = !!data && effLens !== "home";
  const auto = autoMode(lists.length, lastMode.current);
  const mode = data ? viewMode(lists.length, auto, view) : "large";
  useEffect(() => {
    if (!data || lastMode.current === auto) return;
    lastMode.current = auto; writeMode(user, auto);
  }, [data, auto, user]);
  // Recent: the device's last-opened time for each list.
  useEffect(() => { if (here) markOpened(here.id); }, [here?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.body.classList.toggle("selecting", !!selEff && onPage); }, [selEff, onPage]);

  const openLens = (id: string) => {
    setLens(id); setSel(null); setDoneOpen(false); setRenaming(false);
    window.scrollTo(0, 0);
  };
  // The phone's Back: out of select or rename first, then to the cards.
  useBackHandler(() => {
    if (selRef.current) { setSel(null); return true; }
    if (renaming) { setRenaming(false); return true; }
    openLens("home");
    return true;
  }, onPage);

  /* ---- sheets' writes (lists.js) ---- */
  const setAisle = async (id: string, aisle: string) => {
    await post("/api/list/aisle", { item_id: id, aisle });
    toast(t("lists.departmentSet", { name: (dataRef.current?.list.items.find(i => i.item_id === id) || { name: "" }).name, dept: t(`lists.aisle.${aisle}`) }));
    await reload();
  };
  const moveTo = async (ids: string[], listId: string) => {
    const before = dataRef.current!;
    const back = ids.map(id => [id, (before.list.items.find(i => i.item_id === id) || {} as Partial<Item>).list || null] as const);
    for (const id of ids) await post("/api/list/move", { item_id: id, list_id: listId === "else" ? null : listId, ...(lid !== "else" ? { from_list: lid } : {}) });
    markOpened(listId);
    setSheet(null);
    setSel(null);
    const fresh = await reload();
    const dest = listId === "else" ? t("common.everythingElse") : (namedLists(fresh).find(l => l.id === listId) || { name: "" }).name;
    const what = ids.length === 1 ? ((before.list.items.find(i => i.item_id === ids[0]) || {} as Partial<Item>).name || t("lists.item")) : t("common.itemCount", { count: ids.length });
    toast(t("lists.movedTo", { what, dest }), { action: t("common.undo"), onAction: () => guard(async () => {
      for (const [id, l] of back) await post("/api/list/move", { item_id: id, list_id: l });
      await reload();
    }) });
  };
  const alsoOn = async (id: string, listId: string) => {
    await post("/api/list/also", { item_id: id, list_id: listId });
    setSheet(null);
    const fresh = await reload();
    const it = fresh.list.items.find(i => i.item_id === id);
    toast(t("lists.alsoPut", { name: it ? it.name : t("lists.it"), list: lensName(fresh, listId) }), { action: t("common.undo"), onAction: () => guard(async () => {
      await post("/api/list/also", { item_id: id, list_id: listId, on: false });
      await reload();
    }) });
  };
  const createList = async (listName: string, link: StoreLink, moving: string[] | null) => {
    let { stores } = link;
    // A list named after one of your stores ("Costco") links it unless
    // you picked stores yourself (QA 2026-10-30: it said "No store linked").
    if (!stores.length) {
      try {
        const mine = (await get<{ stores?: { name: string }[] }>("/api/stores/mine")).stores || [];
        const hit = mine.find(s => sameStore(s.name, listName));
        if (hit) stores = [hit.name];
      } catch { /* no stores: the list stays unlinked */ }
    }
    const l = await post<{ id: string; name: string }>("/api/lists", { name: listName, stores, store_ids: link.ids });
    if (moving) { await reload(); await moveTo(moving, l.id); return; }
    setSheet(null);
    setLens(l.id);
    await reload();
    toast(t("lists.created", { name: l.name }));
  };
  const saveStores = async (id: string, link: StoreLink) => {
    await post("/api/lists/update", { id, stores: link.stores, store_ids: link.ids });
    setSheet(null);
    await reload();
  };
  const deleteList = (l: { id: string; name: string }) => guard(async () => {
    const out = await post<{ deleted: unknown; index: number }>("/api/lists/delete", { id: l.id });
    setSheet(null);
    setLens("home");
    await reload();
    toast(t("lists.deleted", { name: l.name }), { action: t("common.undo"), onAction: () => guard(async () => {
      await post("/api/lists/restore", { list: out.deleted, index: out.index });
      setLens(l.id);
      await reload();
    }) });
  });
  const addSuggestion = (id: string) => guard(async () => {
    const d = dataRef.current!;
    const it = d.list.items.find(i => i.item_id === id);
    const target = it ? suggestHome(d, it) : "else";
    await post("/api/list/add", target === "else" ? { item_id: id } : { item_id: id, list_id: target });
    const fresh = await reload();
    toast(t("lists.addedTo", { name: it ? it.name : t("lists.it"), list: lensName(fresh, target) }), { action: t("common.undo"), onAction: () => guard(async () => {
      // Back to a suggestion: not on the list, and not dismissed either.
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { manual: false, list: it ? it.list || null : null });
      reloadQuiet();
    }) });
  });
  const dismissSuggestion = (id: string) => guard(async () => {
    const it = dataRef.current!.list.items.find(i => i.item_id === id);
    await post("/api/list/remove", { item_id: id });
    await reload();
    toast(t("lists.skippedForNow", { name: it ? it.name : t("lists.it") }), { action: t("common.undo"), onAction: () => guard(async () => {
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { dismissed_on: null, manual: false });
      await reload();
    }) });
  });
  const neverSuggest = (id: string) => guard(async () => {
    const it = dataRef.current!.list.items.find(i => i.item_id === id);
    await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: true });
    await reload();
    toast(t("lists.wontSuggest", { name: it ? it.name : t("lists.it") }), { action: t("common.undo"), onAction: () => guard(async () => {
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: false });
      await reload();
    }) });
  });

  /* ---- rename in place ---- */
  const startRename = () => {
    if (!here || selEff) return;
    setRenameVal(here.name); setRenaming(true);
  };
  const saveTitle = () => guard(async () => {
    if (!here) { setRenaming(false); return; }
    const n = renameVal.trim();
    if (!n) { toast(t("lists.giveName")); return; }
    if (n !== here.name) await post("/api/lists/update", { id: here.id, name: n });
    setRenaming(false);
    await reload();
  });

  /* ---- row actions ---- */
  const removeItems = async (ids: string[]) => {
    if (!ids.length) return;
    const d = dataRef.current!;
    const names = ids.map(id => (d.list.items.find(i => i.item_id === id) || {} as Partial<Item>).name || t("lists.item"));
    const keys = ids.map(id => id + "|" + lid);
    const unhide = () => setGone(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
    setGone(prev => new Set([...prev, ...keys]));
    if (selRef.current) setSel(null);
    toast(ids.length === 1 ? t("lists.removedOne", { name: names[0] }) : t("lists.removedMany", { count: ids.length }), { action: t("common.undo"), onAction: async () => {
      unhide();
      try { for (const id of ids) await write(id, () => post("/api/list/add", { item_id: id })); }
      catch (e) { toast(errMsg(e)); }
    } });
    try {
      for (const id of ids) await write(id, () => post("/api/list/remove", { item_id: id, ...(lid !== "else" ? { list_id: lid } : {}) }));
    } catch (e) { unhide(); toast(errMsg(e)); }
  };
  const editItem = async (id: string, f: { name: string; qty: number; unit: string; note: string }) => {
    const was = dataRef.current?.list.items.find(i => i.item_id === id);
    patch(i => ({ ...i, ...f }), id);
    try { await write(id, () => post("/api/list/edit", { item_id: id, ...f })); }
    catch (e) { if (was) patch(() => ({ ...was }), id); throw e; }
  };
  /* A tick (or untick) on this list. The item's own list keeps
   * `checked`; an extra list keeps its tick in `checked_in`. */
  const setTick = (id: string, on: boolean) => {
    const local = (i: Item, v: boolean): Item => (lid !== "else" && i.list !== lid && (i.also || []).includes(lid)
      ? { ...i, checked_in: v ? [...new Set([...(i.checked_in || []), lid])] : (i.checked_in || []).filter(x => x !== lid) }
      : { ...i, checked: v });
    patch(i => local(i, on), id);
    if (on) {
      try { navigator.vibrate?.(10); } catch { /* no haptics */ }
      setHold(prev => new Set(prev).add(id));
      window.setTimeout(() => { if (alive.current) setHold(prev => { const n = new Set(prev); n.delete(id); return n; }); }, 400);
    }
    const name = (dataRef.current?.list.items.find(i => i.item_id === id) || { name: "" }).name;
    if (on) toast(t("lists.tickedOff", { name }), { action: t("common.undo"), onAction: () => setTick(id, false) });
    write(id, () => post("/api/list/check", { item_id: id, checked: on, ...(lid !== "else" ? { list_id: lid } : {}) }))
      .catch(e => { patch(i => local(i, !on), id); toast(errMsg(e)); });
  };
  const startSelect = useCallback((id: string | null) => {
    setSel(new Set(id ? [id] : []));
    if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* no haptics */ }
  }, []);

  const togglePick = (id: string) => {
    const next = new Set(selRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSel(next);
  };
  const onRows = async (ev: MouseEvent<HTMLElement>) => {
    const t = ev.target as HTMLElement;
    if (selRef.current) {
      const r = t.closest<HTMLElement>(".listrow");
      if (!r) return;
      togglePick(r.dataset.rowId!);
      return;
    }
    const b = t.closest<HTMLElement>("[data-act]");
    if (!b) {
      // A tap on the rest of the row opens Edit item (owner, 2026-10-31).
      const r = t.closest<HTMLElement>(".listrow");
      if (r && !t.closest(".acts") && !r.closest(".swipewrap.open")) setSheet({ kind: "edit", id: r.dataset.rowId! });
      return;
    }
    const act = b.dataset.act, id = b.dataset.id!;
    const item = dataRef.current ? onListItems(dataRef.current).find(i => i.item_id === id && itemHome(dataRef.current!, i) === lid) : undefined;
    try {
      if (act === "check") { setTick(id, !(item && item.checked)); return; }
      else if (act === "ng-keep") await post("/api/list/grocery-verdict", { item_id: id, kind: "grocery" });
      else if (act === "ng-remove" || act === "remove") { await removeItems([id]); return; }
      else if (act === "move") { setSheet({ kind: "move", ids: [id] }); return; }
      else if (act === "more") { setSheet({ kind: "row", id }); return; }
      else return;
      reloadQuiet();
    } catch (e) { toast(errMsg(e)); }
  };
  const onRowsKey = (ev: KeyboardEvent<HTMLElement>) => {
    const r = (ev.target as HTMLElement).closest?.(".listrow") as HTMLElement | null;
    if (r && ev.target === r && selRef.current && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); togglePick(r.dataset.rowId!); return; }
    if (r && ev.target === r && (ev.key === "Delete" || ev.key === "Backspace")) { ev.preventDefault(); removeItems([r.dataset.rowId!]); }
  };

  /* Swipe a row left to show Move and Remove; long-press a row to
   * start selecting with it picked (app.js wireListSwipe). */
  useEffect(() => {
    const box = smart.current;
    if (!box) return;
    const OPEN = -160;
    let row: HTMLElement | null = null, x0 = 0, y0 = 0, dx = 0, lock: string | null = null, base = 0;
    let press: number | undefined;
    // The finger that long-pressed lifts after select mode has moved the
    // rows up, and its tap would pick whichever row is now under it
    // (QA 2026-10-30). That one click is swallowed.
    let swallow = false;
    const closeAll = (except: Element | null) => box.querySelectorAll<HTMLElement>(".swipewrap.open").forEach(w => {
      if (w !== except) { w.classList.remove("open"); (w.querySelector(".listrow") as HTMLElement).style.transform = ""; }
    });
    const start = (ev: TouchEvent) => {
      swallow = false; // a new touch: only the long press's own lift is eaten
      row = (ev.target as HTMLElement).closest<HTMLElement>(".listrow");
      if (!row || (ev.target as HTMLElement).closest("input") || selRef.current) { row = null; return; }
      const wrap = row.closest(".swipewrap")!;
      closeAll(wrap);
      base = wrap.classList.contains("open") ? OPEN : 0;
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dx = 0; lock = null;
      clearTimeout(press);
      const id = row.dataset.rowId!;
      press = window.setTimeout(() => { if (!lock) { row = null; swallow = true; startSelect(id); } }, 550);
    };
    const move = (ev: TouchEvent) => {
      if (!row) return;
      const mx = ev.touches[0].clientX - x0, my = ev.touches[0].clientY - y0;
      if (!lock && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { lock = Math.abs(mx) > Math.abs(my) * 1.5 ? "x" : "y"; clearTimeout(press); }
      if (lock !== "x") return;
      dx = Math.max(OPEN - 40, Math.min(0, base + mx));
      row.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      clearTimeout(press);
      if (!row) return;
      const r = row, wrap = r.closest(".swipewrap")!; row = null;
      if (lock !== "x") return;
      const isOpen = dx < OPEN / 2;
      wrap.classList.toggle("open", isOpen);
      r.style.transform = isOpen ? `translateX(${OPEN}px)` : "";
    };
    const cancel = () => { clearTimeout(press); if (row) { row.style.transform = ""; row = null; } };
    const eat = (ev: Event) => { if (swallow) { swallow = false; ev.preventDefault(); ev.stopPropagation(); } };
    const menu = (ev: Event) => { if ((ev.target as HTMLElement).closest(".listrow")) ev.preventDefault(); };
    const outside = (ev: Event) => { if (!(ev.target as HTMLElement).closest(".swipewrap.open")) closeAll(null); };
    box.addEventListener("touchstart", start, { passive: true });
    box.addEventListener("touchmove", move, { passive: true });
    box.addEventListener("touchend", end);
    box.addEventListener("touchcancel", cancel);
    box.addEventListener("contextmenu", menu);
    document.addEventListener("click", eat, true);
    document.addEventListener("click", outside);
    return () => {
      clearTimeout(press);
      box.removeEventListener("touchstart", start);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", end);
      box.removeEventListener("touchcancel", cancel);
      box.removeEventListener("contextmenu", menu);
      document.removeEventListener("click", eat, true);
      document.removeEventListener("click", outside);
    };
  }, [onPage, startSelect]);

  /* ---- the composer ---- */
  const items = splitPreview(text);
  const asking = looksLikeAsk(text) || !!parseAddToList(text, lists);
  const addLabel = asking ? (looksLikeAsk(text) ? t("common.ask") : t("common.add")) : (items.length > 1 ? t("lists.addNItems", { count: items.length }) : t("common.add"));
  const changeText = (v: string) => { textRef.current = v; setText(v); setSugOpen(true); setSugIdx(-1); };
  /* Auto-suggest: closed while the text is a question or an add-to-list command. */
  const [sugOpen, setSugOpen] = useState(true);
  const [sugIdx, setSugIdx] = useState(-1);
  const sugRows = useSuggest(text, sugOpen && !asking);
  const sugShown = sugOpen && !asking ? sugRows : [];
  const pickSug = (name: string) => {
    changeText(replaceLast(textRef.current, name));
    setSugOpen(false);
    field.current?.focus();
  };
  /* One wide box (owner, 2026-10-30): the round + shows only once
   * something is typed. */
  const typed = !!text.trim();

  const flashNewRows = (names: string[]) => {
    const want = new Set((names || []).map(n => String(n).toLowerCase()));
    window.setTimeout(() => {
      const hit = [...document.querySelectorAll<HTMLElement>("#view-list .listrow")]
        .filter(r => want.has((r.querySelector(".name")?.textContent || "").trim().toLowerCase()));
      if (!hit.length) return;
      hit.forEach(r => { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); });
      hit[0].scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
  };
  /* Names the rules do not know get one cached model look, after the add has landed. */
  const judgeUnknown = async () => {
    try {
      const r = await post<{ flagged?: unknown[] }>("/api/list/judge", {});
      if (r.flagged && r.flagged.length) reload().catch(() => {});
    } catch { /* unknown stays groceries */ }
  };

  const submit = async () => {
    const txt = textRef.current.trim();
    if (!txt) { toast(t("lists.typeFirst")); return; }
    setAdding(true);
    try {
      // One field for adding and asking: "add naan to Indian Store" files
      // it ($0, no model); a question or a command goes to Arya; anything
      // else is an item.
      const parsed = parseAddToList(txt, lists);
      if (parsed || looksLikeAsk(txt)) {
        changeText("");
        if (parsed) await ask.addToList(txt, parsed);
        else await ask.run(txt, here ? { list: here.name, list_id: here.id } : {});
        setAdding(false);
        return;
      }
      const r = await post<AddResult>("/api/list/from-text", here ? { text: txt, list_id: here.id } : { text: txt });
      // Text typed while the request ran stays; only the sent text clears.
      if (textRef.current.trim() === txt && (r.added || !(r.skipped || []).length)) changeText("");
      setStatus("");
      const one = (r.also || []).length === 1 && here ? r.also![0] : null;
      toast(addToast(r, here ? here.name : t("lists.yourList")), one ? { action: t("lists.moveHere"), onAction: () => guard(async () => {
        await post("/api/list/move", { item_id: one.item_id, list_id: here!.id });
        await reload();
      }) } : undefined);
      reload().then(() => flashNewRows(r.names || [])).catch(() => {});
      judgeUnknown();
    } catch (e) { toast(errMsg(e)); }
    setAdding(false);
  };
  const onFieldKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    const n = sugShown.length;
    if (n && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      ev.preventDefault();
      setSugIdx(i => ev.key === "ArrowDown" ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1));
      return;
    }
    if (n && ev.key === "Escape") { ev.preventDefault(); setSugOpen(false); return; }
    if (ev.key !== "Enter" || ev.shiftKey) return;
    ev.preventDefault();
    if (n && sugIdx >= 0 && sugShown[sugIdx]) { pickSug(sugShown[sugIdx].name); return; }
    submit();
  };
  /* A one-line field flattens a pasted list's line breaks. Keep them as
   * semicolons, which the server split reads as item breaks. */
  const onPaste = (ev: ClipboardEvent<HTMLInputElement>) => {
    const txt = ev.clipboardData.getData("text") || "";
    if (!/[\r\n]/.test(txt)) return;
    ev.preventDefault();
    const f = ev.currentTarget;
    const clean = txt.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean).join("; ");
    const s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? s;
    changeText(f.value.slice(0, s) + clean + f.value.slice(e));
    const at = s + clean.length;
    requestAnimationFrame(() => { try { field.current?.setSelectionRange(at, at); } catch { /* not focusable */ } });
  };
  const dropChip = (n: number) => { const it = splitPreview(textRef.current); it.splice(n, 1); changeText(it.join("; ")); };

  /* The mic talks to Arya: a list is added (with Undo) and a question
   * is answered. If Arya cannot answer, the words land in the field. */
  const mic = async () => {
    if (capture.current) {
      const wav = capture.current.stop();
      capture.current = null;
      setListening(false);
      setStatus(t("common.voice.transcribing"));
      try {
        const spoken = await transcribeBlob(wav);
        setStatus("");
        if (!spoken) failCard(t("lists.input.heardNothing"), t("lists.input.heardNothingBody"), "mic");
        if (spoken) {
          const ok = await ask.run(spoken, here ? { list: here.name, list_id: here.id } : {});
          if (!ok) { const cur = textRef.current.trim(); changeText(cur ? `${cur}, ${spoken}` : spoken); }
        }
      } catch (e) { setStatus(""); failCard(t("lists.input.voiceFailed"), t("lists.input.voiceFailedBody"), "mic"); }
      return;
    }
    if (!voiceSupported()) { failCard(t("lists.input.noVoice"), t("common.voice.unsupported"), "mic"); return; }
    closeCard();
    try {
      capture.current = await startCapture();
      setListening(true);
      setStatus(t("common.voice.listening"));
    } catch { failCard(t("lists.input.micBlocked"), t("lists.input.micBlockedBody"), "mic"); }
  };

  const onPhoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    const input = ev.target;
    if (!f) return;
    setReceiptFile(null);
    closeCard();
    setStatus(t("lists.readingPhoto"));
    try {
      const small = await fitPhoto(f);
      const r = await fetch("/api/list/from-photo" + (here ? `?list_id=${encodeURIComponent(here.id)}` : ""), { method: "POST", headers: { "Content-Type": small.type || "image/jpeg" }, body: small });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
      const out = await r.json();
      setStatus("");
      if (out.kind === "receipt") setReceiptFile(f);
      else if (out.kind === "item") setInCard({ kind: "item", name: out.item, sure: !!out.confident, url: URL.createObjectURL(f) });
      else if (out.kind === "unclear" || !out.added) failCard(t("lists.input.cantTell"), out.reason || t("lists.input.cantTellBody"), "photo", f);
      else {
        toast(t("lists.addedNTo", { count: out.added, where: here ? here.name : t("lists.yourList") }));
        reloadQuiet();
      }
    } catch (e) {
      setStatus("");
      failCard(t("lists.input.cantRead"), t("lists.input.cantReadBody"), "photo", f);
    }
    input.value = "";
  };
  const cardAdd = async (name: string) => {
    closeCard();
    try {
      const r = await post<AddResult>("/api/list/from-text", here ? { text: name, list_id: here.id } : { text: name });
      toast(addToast(r, here ? here.name : t("lists.yourList")));
      reload().then(() => flashNewRows(r.names || [])).catch(() => {});
    } catch (e) { toast(errMsg(e)); }
  };
  const cardEdit = (name: string) => { closeCard(); changeText(name); requestAnimationFrame(() => field.current?.focus()); };
  const cardRetry = (how: "photo" | "mic") => {
    closeCard();
    if (how === "photo") document.getElementById("add-photo")?.click(); else void mic();
  };
  const cardType = () => { closeCard(); requestAnimationFrame(() => field.current?.focus()); };
  /* app.js fileReceiptPhoto, for the camera's receipt offer. */
  const fileReceipt = async () => {
    const f = receiptFile;
    setReceiptFile(null);
    if (!f) return;
    if (!f.size) { toast(t("common.receiptFile.empty")); return; }
    setStatus(t("common.receiptFile.reading"));
    try {
      const out = await decode(f);
      const rec = out.receipt || {};
      setStatus("");
      if (out.demo) { setStatus(t("common.receiptFile.demo")); return; }
      if (out.duplicate) { toast(t("common.receiptFile.duplicate", { merchant: rec.merchant || t("common.receiptFile.thatReceipt"), date: fmtDate(rec.purchased_at) })); return; }
      const saved = lineSavings(rec.lines || []);
      toast(t(saved ? "common.receiptFile.filedSaved" : "common.receiptFile.filed", { merchant: rec.merchant || t("common.receiptFile.theReceipt"), n: (rec.lines || []).length, amount: money(saved) }));
    } catch (e) {
      setStatus("");
      toast(t(isPdfFile(f) ? "common.receiptFile.couldNotReadFile" : "common.receiptFile.couldNotReadPhoto", { error: errMsg(e) }));
    }
  };

  /* ---- Start shopping ---- */
  // One way to shop (#158): the Quest game on this list. A store
  // nobody mapped plays as fog or a labelled simulated store there.
  // Start shopping goes straight there (usability pass): the sheet with
  // one option is gone; Demo Town opens it only when the list's store
  // is closed or has an incident (its store notice). Arya's suggestions stay on the list itself (#list-suggest).
  const startHunt = () => {
    setShopOpen(false);
    nav.show("community", { listId: here ? here.id : "all" });
  };
  // Where? (8): a person helps map the aisle for everyone, as in the Quest help row.
  const snapAisle = async (name: string) => {
    const store = (here && here.stores && here.stores[0]) || "";
    if (!store) { toast(t("lists.whereNoStore")); return; }
    try {
      const out = await get<{ prompt?: unknown }>(`/api/storemap/next?store=${encodeURIComponent(store)}&item=${encodeURIComponent(name)}`);
      if (out && out.prompt) nav.show("capture", { prompt: out.prompt, store, from: "express" });
    } catch (e) { toast(errMsg(e)); }
  };
  const startList = () => { setShopOpen(false); setShopping(effLens); };
  // The Start shopping button: the saved choice decides; the sheet only
  // asks while nothing is saved, or when the person chose Ask me.
  const begin = () => {
    if (town && storeTrouble(town, here ? here.stores || [] : [])) { setShopOpen(true); return; }
    if (shopMode === "quest") startHunt();
    else if (shopMode === "list") startList();
    else setShopOpen(true);
  };
  const pick = (mode: "quest" | "list") => {
    if (shopMode === null) saveShopMode(mode).catch(e => toast(errMsg(e)));
    if (mode === "quest") startHunt(); else startList();
  };
  // Or just tick items as I shop: turns on Just my list for good (owner,
  // option B, 2026-10-30; Settings can switch it back), so the link goes
  // away once that is the saved choice. The toast says so (retest #13).
  const tickAsIShop = () => {
    saveShopMode("list").then(() => toast(t("lists.tickSaved"))).catch(e => toast(errMsg(e)));
    startList();
  };
  const finishTrip = () => {
    setDoneStep(null);
    setShopping(null);
    if (shopMode === "list") patchShop({ list_trip: true }).catch(() => {});
  };
  const doneShopping = () => {
    const ids = done.map(i => i.item_id);
    finishTrip();
    if (ids.length) removeItems(ids);
  };

  /* ---- Eyes ---- */
  const eyeDecide = (rec: string, idx: number, state: string) => guard(async () => {
    await post(`/api/eyes/${rec}/sightings/${idx}`, { state });
    await loadEyes();
  });
  const eyeDelete = (rec: string) => guard(async () => {
    if (!confirm(t("lists.confirmDeletePhoto"))) return;
    await post(`/api/eyes/${rec}/delete`, {});
    toast(t("lists.photoDeleted"));
    await loadEyes();
  });
  const eyesPending = eyes.some(r => (r.sightings || []).some(s => s.state === "pending"));

  /* ---- paint ---- */
  const listStores = here ? here.stores || [] : [];
  const rowProps = (i: Item) => ({ i, also: data ? alsoNames(data, i) : [], picking: !!selEff, picked: !!selEff && selEff.has(i.item_id),
    chip: town && !selEff ? <TownChip town={town} itemId={i.item_id} listStores={listStores} onOpen={() => setTownItem(i.item_id)} /> : null });
  /* Demo Town: send items to the list of another store, making it when there is none. */
  const toStoreList = async (ids: string[], store: string) => {
    let l = lists.find(x => (x.stores || []).some(s => sameStore(s, store)));
    if (!l) { l = await post<{ id: string; name: string }>("/api/lists", { name: store, stores: [store] }); await reload(); }
    await moveTo(ids, l.id);
    return l.id;
  };

  // The group line and who-changed-what (group.js decorateLists).
  const grp = g.enabled ? g.group : null;
  const others = grp ? grp.members.filter(m => !m.me) : [];
  const face = (m: Member) => {
    const src = m.me ? avatar : "";
    return src ? <span className="gm" key={m.handle}><img src={src} alt="" /></span>
      : <span className={"gm" + (m.me ? "" : " other")} key={m.handle}>{(m.handle || "?").charAt(0).toUpperCase()}</span>;
  };

  const card = (id: string, cname: string, sub: string) => {
    const rs = data ? onListItems(data).filter(i => !i.checked && itemHome(data, i) === id) : [];
    const n = data ? suggestions(data).filter(i => suggestHome(data, i) === id).length : 0;
    const names = rs.slice(0, 4).map(i => i.name).join(", ") + (rs.length > 4 ? ` +${rs.length - 4}` : "");
    const r = grp && g.recent && g.recent[id === "else" ? "" : id];
    return (
      <button className="listcard" type="button" data-open-list={id} key={id} onClick={() => openLens(id)}>
        <span className="lc-top"><span className="lc-name">{cname}</span><span className="lc-count">{rs.length || ""}</span><span className="chev">›</span></span>
        {r ? <span className="lc-store gact"><b className="byp">{cap(r.by)}</b> {r.action} {r.name} · {ago(r.at)}</span> : null}
        {sub ? <span className="lc-store">{sub}</span> : null}
        <span className="lc-items">{rs.length ? names : t("lists.nothingOnItYet")}</span>
        {n ? <span className="lc-sugg"><IconSpark />{t("lists.suggestion", { count: n })}</span> : null}
      </button>
    );
  };

  /* Compact tile (4-11 lists) and dense row (12+): name, open count,
   * and for a tile the first two item names. */
  const openOn = (id: string) => (data ? onListItems(data).filter(i => !i.checked && itemHome(data, i) === id) : []);
  const tile = (id: string, cname: string) => {
    const rs = openOn(id);
    return (
      <button className="listcard" type="button" data-open-list={id} key={id} onClick={() => openLens(id)}>
        <span className="lc-name">{cname}</span>
        <span className="lc-count">{t("common.itemCount", { count: rs.length })}</span>
        <span className="lc-items">{rs.length ? rs.slice(0, 2).map(i => i.name).join(", ") + (rs.length > 2 ? "…" : "") : t("lists.nothingOnItYet")}</span>
      </button>
    );
  };
  const navRow = (id: string, cname: string) => {
    const n = openOn(id).length;
    return (
      <button className="navrow listnav" type="button" data-open-list={id} key={id} onClick={() => openLens(id)}>
        <span className="grow"><span className="name">{cname}</span></span>
        <span className="lv-count">{n || ""}</span><span className="chev">›</span>
      </button>
    );
  };
  // Everything else shows in tiles and rows only when it has something.
  const elseName = t("common.everythingElse");
  const elseUsed = !!data && (openOn("else").length > 0 || suggestions(data).some(i => suggestHome(data, i) === "else"));
  const pickView = (v: ListsView) => { setView(v); writeView(v); };
  const dense = () => {
    const q = query.trim();
    if (q) {
      const hits = filterLists(lists, q);
      const elseHit = elseUsed && elseName.toLowerCase().includes(q.toLowerCase());
      return hits.length || elseHit
        ? <div className="group">{hits.map(l => navRow(l.id, l.name))}{elseHit ? navRow("else", elseName) : null}</div>
        : <p className="empty">{t("lists.noListMatches", { q })}</p>;
    }
    const at: Record<string, number> = { ...readOpened() };
    for (const [id, r] of Object.entries(g.recent || {})) if (id) at[id] = Math.max(at[id] || 0, r.at * 1000);
    const az = [...homeLists].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return <>
      <h3 className="sect">{t("lists.recent")}</h3>
      <div className="group">{recentLists(homeLists, at).map(l => navRow(l.id, l.name))}</div>
      <h3 className="sect">{t("lists.allAToZ")}</h3>
      <div className="group">{az.map(l => navRow(l.id, l.name))}{elseUsed ? navRow("else", elseName) : null}</div>
    </>;
  };

  let homeLine = "";
  if (data && !onPage) {
    const allOpen = onListItems(data).filter(i => !i.checked);
    const used = new Set(allOpen.map(i => itemHome(data, i))).size;
    homeLine = allOpen.length ? t("lists.thingsToGet", { count: allOpen.length }) + (used > 1 ? t("lists.acrossLists", { n: used }) : "") : "";
  }

  const sugg = data && !selEff && onPage ? suggestions(data).filter(i => suggestHome(data, i) === lid) : [];
  const shoppingHere = shopping !== null && shopping === effLens && onPage;
  const startBar = (!!open.length || shoppingHere) && !selEff;
  const tickLink = startBar && !shoppingHere && shopMode !== "list";
  const nSel = selEff ? selEff.size : 0;

  return (
    <>
      {!onPage && (
        <div id="lists-home" className={(flags.has("hide-preview") ? "nopreview " : "") + (flags.has("hide-suggestions") ? "nosugg" : "")}>
          {data && lists.length > 0
            ? <EditTitle id="lists-editbtn" title={t("lists.lists")} editTitle={t("lists.editTitle")} editing={editing} onToggle={() => setEditing(e => !e)} />
            : <h1 className="largetitle">{t("lists.lists")}</h1>}
          {grp && others.length ? (
            <p id="list-shared" className="gstack">
              {grp.members.slice(0, 4).map(face)}
              <span>{t("lists.sharedWith", { name: grp.name, value: (() => {
                const ns = others.map(m => "@" + m.handle);
                return ns.length <= 2 ? ns.join(t("lists.and")) : t("lists.namesAndMore", { names: ns.slice(0, 2).join(", "), n: ns.length - 2 });
              })() })}</span>
            </p>
          ) : null}
          <p id="list-line" className="subtitle">{homeLine}</p>
          {editing && data && lists.length > 0 ? (
            <>
              <EditList id="lists-edit" on={arranged.shown} off={arranged.hidden}
                name={id => lists.find(l => l.id === id)?.name || ""}
                sub={id => t("common.itemCount", { count: onListItems(data).filter(i => !i.checked && itemHome(data, i) === id).length })}
                desc={() => t("lists.hiddenSub")}
                hint={t("lists.editHint")} moreTitle={t("lists.hiddenLists")} emptyMore={t("lists.noHidden")}
                onChange={(next, msg) => saveListsLayout({ ...lay, order: next, hidden: lists.map(l => l.id).filter(id => !next.includes(id)) }, msg)}
                onReset={() => saveListsLayout({})} />
              <h3 className="sect">{t("lists.showOnEach")}</h3>
              <div className="group">
                {(["hide-preview", "hide-suggestions"] as const).map(f => (
                  <div className="hubrow" key={f}>
                    <span className="hr-label">{t(`lists.flag.${f}`)}<span className="sub">{t(`lists.flag.${f}Sub`)}</span></span>
                    <button type="button" className="sw" role="switch" data-flag={f} aria-checked={!flags.has(f)} aria-label={t(`lists.flag.${f}`)}
                      onClick={() => saveListsLayout({ ...lay, flags: flags.has(f) ? [...flags].filter(x => x !== f) : [...flags, f] })}><i></i></button>
                  </div>
                ))}
              </div>
            </>
          ) : listsEmpty(data) ? (
            <div id="list-cards">
              <div className="fr-card fr-empty" id="list-empty">
                <img src={asset("assets/characters/basket.webp")} alt="" />
                {EMPTY_CARD_TEXT && <h3 className="fr-h">{t("lists.firstListTitle")}</h3>}
                <p className="fr-s">{t("lists.firstListLine")}</p>
                <button className="btn primary wide" id="list-first" type="button" onClick={() => setSheet({ kind: "new", moving: null })}>{t("lists.createFirstList")}</button>
              </div>
            </div>
          ) : <>
          {data && lists.length >= 4 && (
            <div className="lv-tools">
              {mode === "dense" && (
                <input type="search" id="list-search" className="lv-search" autoComplete="off" value={query}
                  placeholder={t("lists.searchLists", { count: lists.length })} aria-label={t("lists.searchLists", { count: lists.length })}
                  onChange={e => setQuery(e.target.value)} />
              )}
              <span className="lv-seg" role="group" aria-label={t("lists.showAs")}>
                <button type="button" id="list-view-cards" aria-pressed={mode !== "dense"} onClick={() => pickView("cards")}>{t("lists.viewCards")}</button>
                <button type="button" id="list-view-list" aria-pressed={mode === "dense"} onClick={() => pickView("list")}>{t("lists.viewList")}</button>
              </span>
            </div>
          )}
          {mode === "tiles" ? (
            <div id="list-cards" className="listcards" data-mode="tiles">
              {homeLists.map(l => tile(l.id, l.name))}
              {elseUsed ? tile("else", elseName) : null}
            </div>
          ) : mode === "dense" ? (
            <div id="list-cards" data-mode="dense">{dense()}</div>
          ) : (
          <div id="list-cards">
            {data ? <>
              {homeLists.map(l => card(l.id, l.name, (l.stores || []).length ? (l.stores!.length === 1 && sameStore(l.stores![0], l.name) ? "" : l.stores!.join(" · ")) : t("lists.noStoreLinked")))}
              {elseUsed || !lists.length ? card("else", elseName, lists.length ? t("lists.notOnAListYet") : t("lists.makeAListPerStore")) : null}
            </> : loadFailed
              ? <div className="empty" role="alert"><p>{t("lists.couldNotLoad")}</p>
                  <button className="btn" id="lists-retry" type="button" onClick={() => { setLoadFailed(false); reload().catch(e => { if (alive.current) setLoadFailed(true); showErr(e); }); }}>{t("lists.retry")}</button></div>
              : <div className="skel" role="status" aria-label={t("lists.loadingYourList")}><i /><i /><i /></div>}
          </div>
          )}
          <button id="list-new" className="newlist" type="button" onClick={() => setSheet({ kind: "new", moving: null })}><b aria-hidden="true">+</b>{t("lists.newList")}</button>
          {/* Stores, Receipts and Spending live here (owner, 2026-11-01: they left Today). */}
          <div className="group listsstores">
            <button className="navrow" id="lists-stores" type="button" onClick={() => nav.show("stores-mine")}>
              <span className="grow">{t("lists.storesRow")}<span className="sub">{t("lists.storesRowSub")}</span></span><span className="chev">›</span></button>
            <button className="navrow" id="btn-receipts" type="button" onClick={() => nav.show("receipts")}>
              <span className="grow">{t("common.receipts")}<span className="sub">{t("lists.receiptsRowSub")} · {groupName ? t("lists.seenBy.group", { group: groupName }) : t("lists.seenBy.you")}</span></span><span className="chev">›</span></button>
            <button className="navrow" id="btn-analysis" type="button" onClick={() => nav.show("analysis")}>
              <span className="grow">{t("common.analysis")}<span className="sub">{t("lists.spendingRowSub")}</span></span><span className="chev">›</span></button>
          </div>
          </>}
        </div>
      )}

      {onPage && data && (
        <div id="list-page" className={startBar ? "hasstart" + (tickLink ? " hastick" : "") : undefined}>
          <button id="list-back" className="backlink linkbtn" type="button" onClick={() => openLens("home")}><span aria-hidden="true">‹ </span>{t("lists.backToLists")}</button>
          {shoppingHere ? <p className="shopinglabel" id="list-shopping">{t("lists.shoppingLabel")}</p> : null}
          <div className="lhead">
            <h1 className="largetitle" id="lp-title">
              {renaming
                ? <input type="text" id="lp-name-input" className="titleinput" maxLength={40} autoComplete="off" aria-label={t("lists.listName")} autoFocus
                    value={renameVal} onChange={e => setRenameVal(e.target.value)} onFocus={e => e.currentTarget.select()}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                      else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
                    }} />
                : here && !selEff
                  ? <><span id="lp-name">{name}</span><button className="pen" id="lp-pen" type="button" aria-label={t("lists.rename", { name })} onClick={startRename}><IconPen /></button></>
                  : name}
            </h1>
            <button className="linkbtn" id="lp-select" type="button" hidden={shoppingHere || (!renaming && !selEff && !open.length)}
              onClick={() => { if (renaming) { saveTitle(); return; } setSel(selEff ? null : new Set()); }}>
              {renaming ? t("common.save") : selEff ? t("common.done") : t("lists.select")}
            </button>
            <button className="iconbtn" id="lp-menu" type="button" aria-label={t("lists.listOptions")} hidden={!here || !!selEff || renaming || shoppingHere}
              onClick={() => setSheet({ kind: "menu" })}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="2.1" /><circle cx="12" cy="12" r="2.1" /><circle cx="18.5" cy="12" r="2.1" /></svg>
            </button>
          </div>
          <p className="subtitle" id="lp-sub">
            {selEff ? t("lists.nSelected", { n: selEff.size }) : [open.length ? t("lists.nToGet", { n: open.length }) : t("lists.nothingToGet"), ...((here && here.stores) || [])].join(" · ")}
          </p>

          {town && !selEff ? <HeadsUp town={town} itemIds={open.map(i => i.item_id)} listStores={listStores} /> : null}
          <div id="composer" hidden={!!selEff}>
            <div className="addwrap">
            <div className={"addline onebox" + (typed ? " typed" : "")}>
              <input type="text" id="add-text" ref={field} className={looksLikeAsk(text) ? "askish" : undefined}
                placeholder={t("lists.addItemHere")} autoComplete="off" enterKeyHint="done" aria-label={t("lists.addTo", { name })}
                value={text} onChange={e => changeText(e.target.value)} onKeyDown={onFieldKey} onPaste={onPaste}
                onBlur={() => setSugOpen(false)} onFocus={() => setSugOpen(true)}
                role="combobox" aria-expanded={sugShown.length > 0} aria-controls="add-suggest" aria-autocomplete="list"
                aria-activedescendant={sugIdx >= 0 && sugShown[sugIdx] ? "add-sug-" + sugIdx : undefined} />
              <input type="file" id="add-photo" accept="image/*" hidden onChange={onPhoto} />
              {!typed || listening ? (
                <span className="inicons">
                  <button className={"iconbtn" + (listening ? " listening" : "")} id="add-mic" type="button" onClick={mic}
                    aria-label={t("lists.talkToAdd")} title={t("lists.talkToAdd")}><IconMic /></button>
                  <label className="iconbtn" htmlFor="add-photo" aria-label={t("lists.photoToAdd")} title={t("lists.photoToAdd")} {...pickerProps("add-photo")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
                  </label>
                  {findOn && !finding ? <button className="iconbtn" id="list-find-open" type="button" aria-label={t("lists.findInList")} title={t("lists.findInList")} onClick={() => setFinding(true)}><IconSearch /></button> : null}
                </span>
              ) : null}
              {typed && !listening ? <button className="btn primary" id="add-submit" type="button" disabled={adding} onClick={submit} aria-label={addLabel} title={addLabel}>
                {looksLikeAsk(text)
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                  : <span aria-hidden="true">+</span>}
              </button> : null}
            </div>
            <SuggestDrop rows={sugShown} idx={sugIdx} q={lastSegment(text)} onPick={pickSug} here={name} />
            </div>
            {/* Voice, photo and find sit inside the box as labelled icon buttons
              * (owner picked option A, 2026-10-30): the grey box with a row of
              * chips under it wasted a line and read as disabled. */}
            {findOn && finding ? (
              <div className="caprow findbar">
                <span className="findfield"><IconSearch /><input type="search" id="list-find" maxLength={80} autoComplete="off" autoFocus value={find}
                  placeholder={t("lists.findInList")} aria-label={t("lists.findInList")} onChange={e => setFind(e.target.value)} /></span>
                <button className="linkbtn" id="list-find-cancel" type="button" onClick={() => { setFinding(false); setFind(""); }}>{t("common.cancel")}</button>
              </div>
            ) : null}
            <div id="add-split" className="splitpreview" hidden={items.length < 2 || asking}>
              {items.map((n, i) => <span className="spchip" key={i}>{n}<button type="button" data-spx={i} aria-label={t("lists.removeName", { name: n })} onClick={() => dropChip(i)}>×</button></span>)}
            </div>
            <p className="muted nomargin" id="add-status">{status}</p>
            {inCard ? (
              <div className="group pad answercard" id="add-input-card" role="status" style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {inCard.url ? <img src={inCard.url} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", flex: "none" }} /> : null}
                  <div>
                    {inCard.kind === "item"
                      ? <><p className="muted nomargin" style={{ fontSize: 14 }}>{inCard.sure ? t("lists.input.iSee", { name: inCard.name }) : t("lists.input.looksLike", { name: inCard.name })}</p>
                          <p style={{ margin: "2px 0 0", fontSize: 18 }}><strong>{t("lists.input.addQ", { name: inCard.name })}</strong></p></>
                      : <><p className="nomargin"><strong>{inCard.title}</strong></p>
                          <p className="muted nomargin" style={{ fontSize: 14 }}>{inCard.body}</p></>}
                  </div>
                </div>
                <div className="sheetacts">
                  {inCard.kind === "item" ? <>
                    <button className="btn secondary" type="button" data-ic="edit" onClick={() => cardEdit(inCard.name)}>{t("lists.input.editName")}</button>
                    <button className="btn primary" type="button" data-ic="add" onClick={() => cardAdd(inCard.name)}>{t("lists.input.addName", { name: inCard.name })}</button></> : <>
                    <button className="btn secondary" type="button" data-ic="type" onClick={cardType}>{t("lists.input.typeInstead")}</button>
                    <button className="btn primary" type="button" data-ic="retry" onClick={() => cardRetry(inCard.retry)}>{t("lists.input.tryAgain")}</button></>}
                </div>
                {inCard.kind === "item" ? <p className="muted nomargin" style={{ fontSize: 13, marginTop: 8 }}>{t("lists.input.notRight")} <button className="linkbtn" type="button" data-ic="again" onClick={() => cardRetry("photo")}>{t("lists.input.tryAgain")}</button></p> : null}
              </div>
            ) : null}
            <div id="add-receipt-offer">
              {receiptFile ? <>
                <p className="nomargin" style={{ marginTop: 10 }}>{t("lists.thisLooksLikeAReceipt")}</p>
                <p style={{ marginBottom: 0 }}><button className="btn primary" id="add-file-receipt" type="button" onClick={fileReceipt}>{t("lists.fileItAsAReceipt")}</button></p>
              </> : null}
            </div>
          </div>
          <div id="list-answer">{ask.node}</div>

          <div id="list-eyes" hidden={!eyesPending}>
            <h3 className="sect">{t("lists.eyesSightingsToConfirm")}</h3>
            <div className="group pad"><div id="eyes-records">
              {eyes.map(rec => (
                <div className="eyes-record" key={rec.id}>
                  <img src={`/eyes/photos/${rec.id}`} alt={t("lists.eyesPhoto")} />
                  <p className="muted">{PHOTO_KINDS.includes(rec.kind) ? t(`lists.photoKind.${rec.kind}`) : rec.kind} · {fmtDate(rec.date)}</p>
                  {rec.sightings.map((sg, i) => (
                    <div className="row" key={i}><div className="grow"><span className="name">{sg.name}</span>
                      <span className="sub">{sightingLine(sg)}</span></div>
                      {sg.state === "pending" ? <div>
                        <button className="chip eyes-confirm" type="button" onClick={() => eyeDecide(rec.id, i, "confirmed")}>{t("lists.yesItSThere")}</button>{" "}
                        <button className="chip eyes-reject" type="button" onClick={() => eyeDecide(rec.id, i, "rejected")}>{t("lists.notThere")}</button></div> : null}
                    </div>))}
                  <p className="nomargin" style={{ marginTop: 6 }}><button className="chip eyes-del" type="button" onClick={() => eyeDelete(rec.id)}>{t("lists.deletePhoto")}</button></p>
                </div>))}
            </div></div>
          </div>

          {open.length && !selEff && !shoppingHere ? <p className="muted small tickhint" id="list-tickhint">{t("lists.tickHint")}</p> : null}
          <div id="smart-list" ref={smart} onClick={onRows} onKeyDown={onRowsKey}>
            {q && !gShown.length && !eShown.length ? <p className="empty" id="list-nomatch">{t("lists.noMatch", { q })}</p> : null}
            {aisleGroups ? aisleGroups.map(g => {
              const key = `${lid}:${g.aisle}`, shut = folded.has(key);
              return (
                <div className={"aisle" + (shut ? " shut" : "")} key={g.aisle} data-aisle={g.aisle}>
                  <button className="aisle-h" type="button" aria-expanded={!shut} onClick={() => toggleFold(key)}>
                    <b>{t(`lists.aisle.${g.aisle}`)}</b><span className="n">{g.items.length}</span><span className="chev" aria-hidden="true">›</span></button>
                  {shut ? null : <div className="group">{g.items.map(i => <ListRow key={i.item_id} {...rowProps(i)} />)}</div>}
                </div>);
            }) : gShown.length ? <div className="group">{gShown.map(i => <ListRow key={i.item_id} {...rowProps(i)} />)}</div>
              : errands.length || q ? null
                : <div className="group pad"><div className="emptyface-wrap"><img className="emptyface" src="/assets/characters/pantry.webp" alt="" />
                  <p className="empty">{t("lists.nothingOnYetTypeSpeak", { name })}</p></div></div>}
            {eShown.length ? <>
              <p className="grouplabel">{t("lists.otherErrands")}</p>
              <div className="group">{eShown.map(i => <ListRow key={i.item_id} {...rowProps(i)} />)}</div>
            </> : null}
          </div>

          <div id="list-suggest">
            {sugg.length && !shoppingHere ? <>
              <div className="sectrow"><h3 className="sect">{lid === "else" ? t("lists.suggested") : t("lists.suggestedFor", { name })}</h3><span className="muted">{t("lists.tapToSeeWhy")}</span></div>
              <div className="group">{sugg.map(i => {
                const c = charFor(i.name);
                return (
                  // The name is the Why button, Add sits beside it: no button inside a button (retest #25).
                  <div className="row sugrow" key={i.item_id} data-why={i.item_id} onClick={() => setSheet({ kind: "why", id: i.item_id })}>
                    {c ? <img className="rowface" src={`/assets/characters/${c}`} alt="" /> : null}
                    <button type="button" className="grow rowopen" aria-label={t("lists.whySuggests", { name: i.name })}
                      onClick={ev => { ev.stopPropagation(); setSheet({ kind: "why", id: i.item_id }); }}><span className="name">{i.name}</span><span className="why"><IconSpark />{suggestWhy(i)}</span></button>
                    <button className="addchip" type="button" data-sugg-add={i.item_id} aria-label={t("lists.addName", { name: i.name })}
                      onClick={ev => { ev.stopPropagation(); addSuggestion(i.item_id); }}><span aria-hidden="true">+ </span>{t("lists.add")}</button>
                  </div>);
              })}</div>
            </> : null}
          </div>

          <div id="list-done" onClick={onRows}>
            {done.length && !selEff ? (
              <div className="group">
                <div className="row donerow">
                  <button className="linkbtn donetoggle" type="button" data-done-toggle aria-expanded={doneOpen} onClick={e => { e.stopPropagation(); setDoneOpen(!doneOpen); }}><span aria-hidden="true">✓ </span>{t("lists.checkedOff", { doneCount: done.length })}{" "}{doneOpen ? "▴" : "▾"}</button>
                  <button className="linkbtn" type="button" data-done-clear onClick={e => { e.stopPropagation(); removeItems(done.map(i => i.item_id)); }}>{t("lists.clear")}</button>
                </div>
                {doneOpen ? done.map(i => <ListRow key={i.item_id} {...rowProps(i)} />) : null}
              </div>) : null}
          </div>

          <div id="list-startbar" className="startbar" hidden={!startBar}>
            <button id="list-hunt" className="btn primary wide" type="button" onClick={() => (shoppingHere ? setDoneStep("ask") : begin())}>{shoppingHere ? (open.length ? t("lists.doneShoppingLeft", { count: open.length }) : t("lists.doneShoppingAll")) : t("lists.startShoppingItem", { count: open.length })}</button>
            {tickLink ? <button id="list-tick-link" className="linkbtn startlink" type="button" onClick={tickAsIShop}>{t("lists.tickAsIShop")}</button> : null}
          </div>
        </div>
      )}

      {onPage && selEff && (
        <div id="list-selbar" className="selbar">
          <button className="btn secondary dangertext" id="ls-remove" type="button" disabled={!nSel} onClick={() => removeItems([...selEff])}>{t("common.remove")}</button>
          <button className="btn primary" id="ls-move" type="button" disabled={!nSel} onClick={() => setSheet({ kind: "move", ids: [...selEff] })}>{nSel ? t("lists.moveNTo", { n: nSel }) : t("lists.moveTo")}</button>
        </div>
      )}

      {data && (
        <ListSheet sheet={sheet} setSheet={setSheet} data={data} lens={effLens}
          actions={{ onCreate: createList, onSaveStores: saveStores, onDelete: deleteList, onMove: moveTo,
            onWhyAdd: addSuggestion, onWhyNot: dismissSuggestion, onWhyNever: neverSuggest, onRemove: removeItems, onAisle: setAisle,
            shopping: shoppingHere, onSnap: snapAisle, onChanged: reloadQuiet, onAlso: alsoOn, onEdit: editItem, onHistory: id => nav.show("item", { id }) }} />
      )}

      {town ? <TownItemSheet town={town} itemId={townItem} listStores={listStores} onClose={() => setTownItem(null)}
        onMove={store => guard(async () => { const id = townItem!; setTownItem(null); await toStoreList([id], store); })} /> : null}

      <Sheet open={doneStep === "ask"} onClose={() => setDoneStep(null)} id="done-sheet" labelledBy="done-title">
        <div className="donesheet">
          <h3 id="done-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{t("lists.doneTitle")}</h3>
          <p className="sub">{t("lists.doneSummary", { done: done.length, left: open.length })}</p>
          <button className="btn primary wide" id="done-receipt" type="button" onClick={() => { setDoneStep("clear"); document.getElementById("add-photo")?.click(); }}>{t("lists.addReceipt")}</button>
          {/* The demo has no paper receipt: a sample one, as Use soon has a sample date (retest 2026-10-31 #16). */}
          {demo ? <button className="btn wide" id="done-sample" type="button" onClick={() => guard(async () => {
            const r = await post<{ merchant: string; lines: number; total: number }>("/api/list/sample-receipt",
              { store: (here && here.stores && here.stores[0]) || (here ? here.name : ""), item_ids: done.map(i => i.item_id) });
            toast(t("lists.sampleFiled", { merchant: r.merchant, count: r.lines, amount: money(r.total) }));
            setDoneStep("clear");
          })}>{t("addReceiptSheet.useASampleReceipt")} <span className="demotag">{t("common.demo")}</span></button> : null}
          <button className="btn secondary wide" id="done-skip" type="button" onClick={() => (done.length ? setDoneStep("clear") : finishTrip())}>{t("lists.skipReceipt")}</button>
          <button className="linkbtn" id="done-keep" type="button" onClick={() => setDoneStep(null)}>{t("lists.keepShopping")}</button>
        </div>
      </Sheet>
      <Sheet open={doneStep === "clear"} onClose={finishTrip} id="clear-sheet" labelledBy="clear-title">
        <div className="donesheet">
          <h3 id="clear-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{t("lists.clearTitle")}</h3>
          <p className="sub">{t("lists.clearSub")}</p>
          <button className="btn primary wide" id="clear-do" type="button" disabled={!done.length} onClick={doneShopping}>{t("lists.clearDo", { count: done.length })}</button>
          <button className="btn secondary wide" id="clear-keep" type="button" onClick={finishTrip}>{t("lists.keepThem")}</button>
        </div>
      </Sheet>

      {/* Demo Town only, when the list's store is in trouble: its store notice before the quest. */}
      <Sheet open={shopOpen} onClose={() => setShopOpen(false)} id="shop-sheet" labelledBy="shop-title">
        <div className="sheethead"><h3 id="shop-title" className="nomargin">{t("lists.shopHow")}</h3><button id="shop-close" className="linkbtn" type="button" onClick={() => setShopOpen(false)}>{t("common.close")}</button></div>
        <p className="sub">{t("lists.shopTitle", { name: here ? here.name : t("common.everythingElse"), count: open.length })}</p>
        {town ? <StoreNotice town={town} listStores={listStores} onSwitch={store => guard(async () => {
          const id = await toStoreList(open.map(i => i.item_id), store);
          setShopOpen(false);
          openLens(id);
        })} /> : null}
        <div className="group shopmodes">
          <button className="hubrow" type="button" data-shop="quest" data-first onClick={() => pick("quest")}><img className="rowface" src="/assets/scenes/storefront.webp" alt="" /><span className="hr-label">{t("lists.startAQuest")}<span className="sub">{t("lists.shopQuestSub")}</span></span><span className="chev">›</span></button>
          <button className="hubrow" type="button" data-shop="list" onClick={() => pick("list")}><span className="hr-label">{t("lists.shopJustList")}<span className="sub">{t("lists.shopJustListSub")}</span></span><span className="chev">›</span></button>
        </div>
        {shopMode === null ? <>
          <button className="linkbtn" id="shop-ask-every" type="button" onClick={() => saveShopMode("ask").catch(e => toast(errMsg(e)))}>{t("lists.shopAskEvery")}</button>
          <p className="shopnote">{t("lists.shopSaved")}</p>
        </> : null}
      </Sheet>
    </>
  );
}
