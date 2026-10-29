import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useNav } from "../app/nav";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { decode, isPdfFile } from "../ui/AddReceiptSheet";
import { IconCheck, IconMic, IconPen, IconSpark } from "../ui/icons";
import { get, post } from "../lib/api";
import { fmtDate, qtyFmt, qtyTag } from "../lib/format";
import { charFor, useCharacters } from "../lib/characters";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import { ListSheet, type SheetState } from "./lists/ListSheets";
import { looksLikeAsk, parseAddToList, useAsk } from "./lists/AskCard";
import {
  askLaterHas, cache, itemHome, lensName, lensState, namedLists, onListItems, sameStore,
  suggestHome, suggestions, suggestWhy, type HomeData, type Item,
} from "./lists/model";

/* Port of pwa/index.html #view-list and the Lists half of pwa/app.js
 * (renderList, paintListsHome, paintListPage, the Start shopping sheet,
 * swipe / select / remove / quantity, the one-field composer with mic
 * and camera, Eyes sightings) with pwa/lists.js in lists/ListSheets.tsx
 * and pwa/aryaask.js in lists/AskCard.tsx. The Shell already renders
 * <section id="view-list">.
 *
 * Start shopping: nav.show("store", { fromList: {id,name,stores}|null,
 * fastMode: "quest" | "express" }), what quest.js startHuntFromList set
 * on Q.draft.
 *
 * Local helpers kept here: the swipe / long-press wiring, the split
 * preview, the group line and the Eyes block. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cap = (h: string) => (h ? h.charAt(0).toUpperCase() + h.slice(1) : "");

/* ---------------- the add field's split preview (app.js bindAdd) ---------------- */

const ADD_LEAD = /^(please get |please buy |please add |add |buy |get |and |i need some |i need |we need some |we need |i want some |i want |get me some |get me )/i;
function splitPreview(text: string): string[] {
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

/* ---------------- the group line (group.js decorateLists) ---------------- */

type Member = { handle: string; me?: boolean; owner?: boolean };
type GState = { enabled?: boolean; group?: { name: string; members: Member[] } | null;
  recent?: Record<string, { by: string; action: string; name: string; at: number }> };

function ago(sec: number) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - sec));
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return Math.round(s / 86400) === 1 ? "yesterday" : `${Math.round(s / 86400)} days ago`;
}

/* ---------------- Eyes ---------------- */

type Sighting = { name: string; state: string; judge_agree?: boolean };
type EyesRec = { id: string; kind: string; date: string; sightings: Sighting[] };

/* ---------------- one list row ---------------- */

function QtyBtn({ item, onCommit, onCancel }: { item: Item; onCommit: (id: string, q: number, u: string) => Promise<void>; onCancel: () => void }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [u, setU] = useState("");
  const done = useRef(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const qInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { qInput.current?.focus(); qInput.current?.select(); } }, [editing]);
  if (!editing) {
    const one = !item.unit && Number(item.qty || 1) === 1;
    return (
      <button className={"qtybtn" + (one ? " one" : "")} data-act="qty" data-id={item.item_id} type="button"
        aria-label={`Quantity ${qtyTag(item) || "1"}. Tap to change.`}
        onClick={() => { done.current = false; setQ(String(Number(item.qty) || 1)); setU(item.unit || ""); setEditing(true); }}>
        {item.unit ? qtyFmt(item.qty) + " " + item.unit : "× " + qtyFmt(item.qty)}
      </button>
    );
  }
  const commit = async () => {
    if (done.current) return; done.current = true;
    const n = Math.max(1, Math.round(Number(q) || 1));
    const unit = u.trim();
    try {
      if (n !== Number(item.qty) || unit !== (item.unit || "")) await onCommit(item.item_id, n, unit);
      else onCancel();
    } catch { /* the caller toasts */ }
    setEditing(false);
  };
  return (
    <span className="qtyedit" ref={wrap}
      onBlur={ev => { if (!wrap.current?.contains(ev.relatedTarget as Node | null)) commit(); }}
      onKeyDown={ev => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { done.current = true; setEditing(false); onCancel(); }
      }}>
      <input type="number" min="1" step="1" inputMode="numeric" className="qtyinput" aria-label="Quantity" ref={qInput}
        value={q} onChange={e => setQ(e.target.value)} />
      <input type="text" maxLength={16} autoComplete="off" className="qtyinput qtyunit" placeholder="unit" aria-label="Unit, for example kg or L"
        value={u} onChange={e => setU(e.target.value)} />
    </span>
  );
}

function ListRow({ i, picking, picked, onQty, onReload }: { i: Item; picking: boolean; picked: boolean;
  onQty: (id: string, q: number, u: string) => Promise<void>; onReload: () => void }) {
  const sub = i.added_by ? `Added by ${i.added_by}` : "";
  return (
    <div className="swipewrap" data-wrap-id={i.item_id}>
      <div className="acts" aria-hidden="true"><button type="button" className="mv" data-act="move" data-id={i.item_id} tabIndex={-1}>Move</button><button type="button" className="rm" data-act="remove" data-id={i.item_id} tabIndex={-1}>Remove</button></div>
      <div className={"row listrow" + (i.checked ? " checked" : "") + (picked ? " picked" : "")} tabIndex={0} data-row-id={i.item_id}>
        {picking ? <span className="pick" data-act="pick" data-id={i.item_id}><IconCheck /></span>
          : <button className="check" type="button" data-act="check" data-id={i.item_id} aria-label={`Check off ${i.name}`}><IconCheck /></button>}
        <div className="grow">{picking ? <span className="name">{i.name}</span> : <a href="#" className="name item-link" data-id={i.item_id}>{i.name}</a>}
          {sub ? <span className="sub">{sub}</span> : null}
          {askLaterHas(i.name) ? <span className="sub asklater">To ask — kept as typed; asked again at the next plan.</span> : null}
          {i.not_grocery && !picking ? <span className="sub notgrocery">Not a grocery item? Added anyway. <button className="linkbtn" type="button" data-act="ng-keep" data-id={i.item_id}>It is groceries</button> · <button className="linkbtn" type="button" data-act="ng-remove" data-id={i.item_id}>Remove</button></span> : null}</div>
        {picking ? null : <QtyBtn item={i} onCommit={onQty} onCancel={onReload} />}
      </div>
    </div>
  );
}

/* ---------------- the screen ---------------- */

export function Lists() {
  const nav = useNav();
  const { toast, showErr } = useToast();
  const avatar = useAvatar().src;
  useCharacters();

  const [data, setData] = useState<HomeData | null>(cache.data);
  const dataRef = useRef<HomeData | null>(cache.data);
  // Today's list cards open one list (app.js: listLens = card's id).
  const [lens, setLensState] = useState(() => {
    const want = nav.params.lens;
    if (typeof want === "string" && want) lensState.lens = want;
    return lensState.lens;
  });
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [g, setG] = useState<GState>({ enabled: false, group: null, recent: {} });
  const [eyes, setEyes] = useState<EyesRec[]>([]);

  const [text, setText] = useState("");
  const textRef = useRef("");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  const [listening, setListening] = useState(false);
  const capture = useRef<Capture | null>(null);
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
    if (alive.current) setData(h);
    loadGroup();
    return h;
  }, [loadGroup]);
  const reloadQuiet = useCallback(() => { reload().catch(showErr); }, [reload, showErr]);
  const loadEyes = useCallback(async () => {
    const r = await get<{ records: EyesRec[] }>("/api/eyes").catch(() => ({ records: [] as EyesRec[] }));
    if (alive.current) setEyes(r.records || []);
  }, []);

  useEffect(() => { reload().catch(showErr); loadEyes(); }, [reload, loadEyes, showErr]);

  const ask = useAsk(reloadQuiet);

  /* ---- derived ---- */
  const lists = namedLists(data);
  // A lens whose list is gone falls back to the cards.
  const effLens = data && lens !== "home" && lens !== "else" && !lists.some(l => l.id === lens) ? "home" : lens;
  const here = lists.find(l => l.id === effLens) || null;
  const lid = here ? here.id : "else";
  const name = data ? lensName(data, lid) : "";
  const rows = data ? onListItems(data).filter(i => itemHome(data, i) === lid) : [];
  const open = rows.filter(i => !i.checked), done = rows.filter(i => i.checked);
  const groceries = open.filter(i => !i.not_grocery), errands = open.filter(i => i.not_grocery);
  const selEff = useMemo(() => (sel ? new Set([...sel].filter(x => open.some(i => i.item_id === x))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, data, effLens]);
  const selRef = useRef<Set<string> | null>(null);
  selRef.current = selEff;
  const onPage = !!data && effLens !== "home";

  useEffect(() => { document.body.classList.toggle("selecting", !!selEff && onPage); }, [selEff, onPage]);

  const openLens = (id: string) => {
    setLens(id); setSel(null); setDoneOpen(false); setRenaming(false);
    window.scrollTo(0, 0);
  };

  /* ---- sheets' writes (lists.js) ---- */
  const moveTo = async (ids: string[], listId: string) => {
    const before = dataRef.current!;
    const back = ids.map(id => [id, (before.list.items.find(i => i.item_id === id) || {} as Partial<Item>).list || null] as const);
    for (const id of ids) await post("/api/list/move", { item_id: id, list_id: listId === "else" ? null : listId });
    setSheet(null);
    setSel(null);
    const fresh = await reload();
    const dest = listId === "else" ? "Everything else" : (namedLists(fresh).find(l => l.id === listId) || { name: "" }).name;
    const what = ids.length === 1 ? ((before.list.items.find(i => i.item_id === ids[0]) || {} as Partial<Item>).name || "Item") : `${ids.length} items`;
    toast(`Moved ${what} to ${dest}.`, { action: "Undo", onAction: () => guard(async () => {
      for (const [id, l] of back) await post("/api/list/move", { item_id: id, list_id: l });
      await reload();
    }) });
  };
  const createList = async (listName: string, stores: string[], moving: string[] | null) => {
    const l = await post<{ id: string; name: string }>("/api/lists", { name: listName, stores });
    if (moving) { await reload(); await moveTo(moving, l.id); return; }
    setSheet(null);
    setLens(l.id);
    await reload();
    toast(`Created ${l.name}.`);
  };
  const saveStores = async (id: string, stores: string[]) => {
    await post("/api/lists/update", { id, stores });
    setSheet(null);
    await reload();
  };
  const deleteList = (l: { id: string; name: string }) => guard(async () => {
    const out = await post<{ deleted: unknown; index: number }>("/api/lists/delete", { id: l.id });
    setSheet(null);
    setLens("home");
    await reload();
    toast(`Deleted ${l.name}.`, { action: "Undo", onAction: () => guard(async () => {
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
    toast(`Added ${it ? it.name : "it"} to ${lensName(fresh, target)}.`, { action: "Undo", onAction: () => guard(async () => {
      // Back to a suggestion: not on the list, and not dismissed either.
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { manual: false, list: it ? it.list || null : null });
      reloadQuiet();
    }) });
  });
  const dismissSuggestion = (id: string) => guard(async () => {
    const it = dataRef.current!.list.items.find(i => i.item_id === id);
    await post("/api/list/remove", { item_id: id });
    await reload();
    toast(`Skipped ${it ? it.name : "it"} for now.`, { action: "Undo", onAction: () => guard(async () => {
      await post(`/api/items/${encodeURIComponent(id)}/flag`, { dismissed_on: null, manual: false });
      await reload();
    }) });
  });
  const neverSuggest = (id: string) => guard(async () => {
    const it = dataRef.current!.list.items.find(i => i.item_id === id);
    await post(`/api/items/${encodeURIComponent(id)}/flag`, { never: true });
    await reload();
    toast(`Arya won't suggest ${it ? it.name : "it"} again.`, { action: "Undo", onAction: () => guard(async () => {
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
    if (!n) { toast("Give the list a name."); return; }
    if (n !== here.name) await post("/api/lists/update", { id: here.id, name: n });
    setRenaming(false);
    await reload();
  });

  /* ---- row actions ---- */
  const removeItems = async (ids: string[]) => {
    if (!ids.length) return;
    const d = dataRef.current!;
    const names = ids.map(id => (d.list.items.find(i => i.item_id === id) || {} as Partial<Item>).name || "Item");
    try {
      for (const id of ids) await post("/api/list/remove", { item_id: id });
      if (selRef.current) setSel(null);
      reloadQuiet();
      toast(ids.length === 1 ? `${names[0]} removed.` : `${ids.length} items removed.`, { action: "Undo", onAction: async () => {
        try { for (const id of ids) await post("/api/list/add", { item_id: id }); reloadQuiet(); }
        catch (e) { toast(errMsg(e)); }
      } });
    } catch (e) { toast(errMsg(e)); }
  };
  const setQty = async (id: string, qty: number, unit: string) => {
    try { await post("/api/list/qty", { item_id: id, qty, unit }); }
    catch (e) { toast(errMsg(e)); }
    reloadQuiet();
  };
  const startSelect = useCallback((id: string | null) => {
    setSel(new Set(id ? [id] : []));
    if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* no haptics */ }
  }, []);

  const onRows = async (ev: MouseEvent<HTMLElement>) => {
    const t = ev.target as HTMLElement;
    const link = t.closest<HTMLElement>(".item-link");
    if (link) { ev.preventDefault(); nav.show("item", { id: link.dataset.id }); return; }
    if (selRef.current) {
      const r = t.closest<HTMLElement>(".listrow");
      if (!r) return;
      const id = r.dataset.rowId!;
      const next = new Set(selRef.current);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSel(next);
      return;
    }
    const b = t.closest<HTMLElement>("[data-act]");
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id!;
    const item = dataRef.current?.list.items.find(i => i.item_id === id);
    try {
      if (act === "check") await post("/api/list/check", { item_id: id, checked: !(item && item.checked) });
      else if (act === "ng-keep") await post("/api/list/grocery-verdict", { item_id: id, kind: "grocery" });
      else if (act === "ng-remove" || act === "remove") { await removeItems([id]); return; }
      else if (act === "move") { setSheet({ kind: "move", ids: [id] }); return; }
      else return;
      reloadQuiet();
    } catch (e) { toast(errMsg(e)); }
  };
  const onRowsKey = (ev: KeyboardEvent<HTMLElement>) => {
    const r = (ev.target as HTMLElement).closest?.(".listrow") as HTMLElement | null;
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
    const closeAll = (except: Element | null) => box.querySelectorAll<HTMLElement>(".swipewrap.open").forEach(w => {
      if (w !== except) { w.classList.remove("open"); (w.querySelector(".listrow") as HTMLElement).style.transform = ""; }
    });
    const start = (ev: TouchEvent) => {
      row = (ev.target as HTMLElement).closest<HTMLElement>(".listrow");
      if (!row || (ev.target as HTMLElement).closest("input") || selRef.current) { row = null; return; }
      const wrap = row.closest(".swipewrap")!;
      closeAll(wrap);
      base = wrap.classList.contains("open") ? OPEN : 0;
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dx = 0; lock = null;
      clearTimeout(press);
      const id = row.dataset.rowId!;
      press = window.setTimeout(() => { if (!lock) { row = null; startSelect(id); } }, 550);
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
    const menu = (ev: Event) => { if ((ev.target as HTMLElement).closest(".listrow")) ev.preventDefault(); };
    const outside = (ev: Event) => { if (!(ev.target as HTMLElement).closest(".swipewrap.open")) closeAll(null); };
    box.addEventListener("touchstart", start, { passive: true });
    box.addEventListener("touchmove", move, { passive: true });
    box.addEventListener("touchend", end);
    box.addEventListener("touchcancel", cancel);
    box.addEventListener("contextmenu", menu);
    document.addEventListener("click", outside);
    return () => {
      clearTimeout(press);
      box.removeEventListener("touchstart", start);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", end);
      box.removeEventListener("touchcancel", cancel);
      box.removeEventListener("contextmenu", menu);
      document.removeEventListener("click", outside);
    };
  }, [onPage, startSelect]);

  /* ---- the composer ---- */
  const items = splitPreview(text);
  const asking = looksLikeAsk(text) || !!parseAddToList(text, lists);
  const addLabel = asking ? (looksLikeAsk(text) ? "Ask" : "Add") : (items.length > 1 ? `Add ${items.length} items` : "Add");
  const changeText = (v: string) => { textRef.current = v; setText(v); };

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
    const t = textRef.current.trim();
    if (!t) { toast("Type or paste the items first."); return; }
    setAdding(true);
    try {
      // One field for adding and asking: "add naan to Indian Store" files
      // it ($0, no model); a question or a command goes to Arya; anything
      // else is an item.
      const parsed = parseAddToList(t, lists);
      if (parsed || looksLikeAsk(t)) {
        changeText("");
        if (parsed) await ask.addToList(t, parsed);
        else await ask.run(t, here ? { list: here.name, list_id: here.id } : {});
        setAdding(false);
        return;
      }
      const r = await post<{ added: number; already?: number; skipped?: string[]; names?: string[] }>("/api/list/from-text", here ? { text: t, list_id: here.id } : { text: t });
      // Text typed while the request ran stays; only the sent text clears.
      if (textRef.current.trim() === t) changeText("");
      setStatus("");
      const dup = r.already ? ` ${r.already} already on it.` : "";
      const skip = (r.skipped || []).length ? ` Left out (not items): ${r.skipped!.join(", ")}.` : "";
      const where = here ? here.name : "your list";
      toast((r.added === 1 ? `Added 1 item to ${where}.` : `Added ${r.added} items to ${where}.`) + dup + skip);
      reload().then(() => flashNewRows(r.names || [])).catch(() => {});
      judgeUnknown();
    } catch (e) { toast(errMsg(e)); }
    setAdding(false);
  };
  const onFieldKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    ev.preventDefault(); submit();
  };
  /* A one-line field flattens a pasted list's line breaks. Keep them as
   * semicolons, which the server split reads as item breaks. */
  const onPaste = (ev: ClipboardEvent<HTMLInputElement>) => {
    const t = ev.clipboardData.getData("text") || "";
    if (!/[\r\n]/.test(t)) return;
    ev.preventDefault();
    const f = ev.currentTarget;
    const clean = t.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean).join("; ");
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
      setStatus("Transcribing with Muse Voice Transcribe…");
      try {
        const spoken = await transcribeBlob(wav);
        setStatus(spoken ? "" : "That did not come through. Try again, closer to the mic.");
        if (spoken) {
          const ok = await ask.run(spoken, here ? { list: here.name, list_id: here.id } : {});
          if (!ok) { const cur = textRef.current.trim(); changeText(cur ? `${cur}, ${spoken}` : spoken); }
        }
      } catch (e) { setStatus(""); toast("Transcription failed: " + errMsg(e)); }
      return;
    }
    if (!voiceSupported()) { setStatus("Voice input is not available in this browser. The microphone on your keyboard works too."); return; }
    try {
      capture.current = await startCapture();
      setListening(true);
      setStatus("Listening…");
    } catch { setStatus("Microphone access was refused. You can type instead."); }
  };

  const onPhoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    const input = ev.target;
    if (!f) return;
    setReceiptFile(null);
    setStatus("Reading the photo with Spark…");
    try {
      const r = await fetch("/api/list/from-photo", { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
      const out = await r.json();
      setStatus("");
      if (out.kind === "receipt") setReceiptFile(f);
      else {
        toast(out.added === 1 ? "Added 1 item to your list." : `Added ${out.added} items to your list.`);
        reloadQuiet();
      }
    } catch (e) {
      setStatus("");
      toast("Could not read that photo: " + errMsg(e));
    }
    input.value = "";
  };
  /* app.js fileReceiptPhoto, for the camera's receipt offer. */
  const fileReceipt = async () => {
    const f = receiptFile;
    setReceiptFile(null);
    if (!f) return;
    if (!f.size) { toast("That file arrived empty — if it is still downloading, wait for it to finish, then try again."); return; }
    setStatus("Reading the receipt — this can take up to a minute.");
    try {
      const out = await decode(f);
      const rec = out.receipt || {};
      setStatus("");
      if (out.demo) { setStatus("Read live — kept for this demo visit only."); return; }
      if (out.duplicate) { toast(`Already filed — ${rec.merchant || "that receipt"}, ${fmtDate(rec.purchased_at)}. Skipped, so the trip is not counted twice.`); return; }
      toast(`Filed ${rec.merchant || "the receipt"} — ${(rec.lines || []).length} lines. Each receipt makes your price comparisons sharper. Anything unsure is in Receipts, under Needs your eye.`);
    } catch (e) {
      setStatus("");
      toast(`Could not read that ${isPdfFile(f) ? "file" : "photo"}: ` + errMsg(e));
    }
  };

  /* ---- Start shopping ---- */
  const shopSugg = data && shopOpen ? suggestions(data).filter(i => suggestHome(data, i) === lid) : [];
  const addAllSuggested = () => guard(async () => {
    const ids = shopSugg.map(i => i.item_id);
    for (const id of ids) await post("/api/list/add", lid === "else" ? { item_id: id } : { item_id: id, list_id: lid });
    await reload();
  });
  const startHunt = (mode: string) => {
    setShopOpen(false);
    // A named list plans from its own items; Everything else plans from the whole list.
    nav.show("store", { fromList: here ? { id: here.id, name: here.name, stores: here.stores || [] } : null, fastMode: mode });
  };

  /* ---- Eyes ---- */
  const eyeDecide = (rec: string, idx: number, state: string) => guard(async () => {
    await post(`/api/eyes/${rec}/sightings/${idx}`, { state });
    await loadEyes();
  });
  const eyeDelete = (rec: string) => guard(async () => {
    if (!confirm("Delete this photo and its sightings? This cannot be undone.")) return;
    await post(`/api/eyes/${rec}/delete`, {});
    toast("Photo deleted.");
    await loadEyes();
  });
  const eyesPending = eyes.some(r => (r.sightings || []).some(s => s.state === "pending"));

  /* ---- paint ---- */
  const rowProps = (i: Item) => ({ i, picking: !!selEff, picked: !!selEff && selEff.has(i.item_id), onQty: setQty, onReload: reloadQuiet });

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
        <span className="lc-items">{rs.length ? names : "Nothing on it yet"}</span>
        {n ? <span className="lc-sugg"><IconSpark />{n} suggestion{n === 1 ? "" : "s"}</span> : null}
      </button>
    );
  };

  let homeLine = "";
  if (data && !onPage) {
    const allOpen = onListItems(data).filter(i => !i.checked);
    const used = new Set(allOpen.map(i => itemHome(data, i))).size;
    homeLine = allOpen.length ? `${allOpen.length} thing${allOpen.length === 1 ? "" : "s"} to get${used > 1 ? ` across ${used} lists` : ""}` : "";
  }

  const sugg = data && !selEff && onPage ? suggestions(data).filter(i => suggestHome(data, i) === lid) : [];
  const startBar = !!open.length && !selEff;
  const nSel = selEff ? selEff.size : 0;

  return (
    <>
      {!onPage && (
        <div id="lists-home">
          <h2 className="largetitle">Lists</h2>
          {grp && others.length ? (
            <p id="list-shared" className="gstack">
              {grp.members.slice(0, 4).map(face)}
              <span>{grp.name} · shared with {(() => {
                const ns = others.map(m => cap(m.handle));
                return ns.length <= 2 ? ns.join(" and ") : `${ns.slice(0, 2).join(", ")} and ${ns.length - 2} more`;
              })()}</span>
            </p>
          ) : null}
          <p id="list-line" className="subtitle">{homeLine}</p>
          <div id="list-cards">
            {data ? <>
              {lists.map(l => card(l.id, l.name, (l.stores || []).length ? (l.stores!.length === 1 && sameStore(l.stores![0], l.name) ? "" : l.stores!.join(" · ")) : "No store linked"))}
              {card("else", "Everything else", lists.length ? "Not on a list yet" : "Make a list for each store you shop at")}
            </> : <p className="empty">Loading your list…</p>}
          </div>
          <button id="list-new" className="newlist" type="button" onClick={() => setSheet({ kind: "new", moving: null })}><b aria-hidden="true">+</b>New list</button>
        </div>
      )}

      {onPage && data && (
        <div id="list-page" className={startBar ? "hasstart" : undefined}>
          <button id="list-back" className="backlink linkbtn" type="button" onClick={() => openLens("home")}>‹ Lists</button>
          <div className="lhead">
            <h2 className="largetitle" id="lp-title">
              {renaming
                ? <input type="text" id="lp-name-input" className="titleinput" maxLength={40} autoComplete="off" aria-label="List name" autoFocus
                    value={renameVal} onChange={e => setRenameVal(e.target.value)} onFocus={e => e.currentTarget.select()}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                      else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
                    }} />
                : here && !selEff
                  ? <><span id="lp-name">{name}</span><button className="pen" id="lp-pen" type="button" aria-label={`Rename ${name}`} onClick={startRename}><IconPen /></button></>
                  : name}
            </h2>
            <button className="linkbtn" id="lp-select" type="button" hidden={!renaming && !selEff && !open.length}
              onClick={() => { if (renaming) { saveTitle(); return; } setSel(selEff ? null : new Set()); }}>
              {renaming ? "Save" : selEff ? "Done" : "Select"}
            </button>
            <button className="iconbtn" id="lp-menu" type="button" aria-label="List options" hidden={!here || !!selEff || renaming}
              onClick={() => setSheet({ kind: "menu" })}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="2.1" /><circle cx="12" cy="12" r="2.1" /><circle cx="18.5" cy="12" r="2.1" /></svg>
            </button>
          </div>
          <p className="subtitle" id="lp-sub">
            {selEff ? `${selEff.size} selected` : [open.length ? `${open.length} to get` : "Nothing to get", ...((here && here.stores) || [])].join(" · ")}
          </p>

          <div id="composer" hidden={!!selEff}>
            <div className="addline">
              <button className={"iconbtn" + (listening ? " listening" : "")} id="add-mic" type="button" aria-label="Speak your list" onClick={mic}><IconMic /></button>
              <input type="text" id="add-text" ref={field} className={looksLikeAsk(text) ? "askish" : undefined}
                placeholder={name.length <= 8 ? `Add to ${name}` : "Add an item"} autoComplete="off" aria-label={`Add to ${name}`}
                value={text} onChange={e => changeText(e.target.value)} onKeyDown={onFieldKey} onPaste={onPaste} />
              <label className="iconbtn" htmlFor="add-photo" aria-label="Add from a photo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
              </label>
              <input type="file" id="add-photo" accept="image/*" hidden onChange={onPhoto} />
              <button className="btn primary" id="add-submit" type="button" disabled={adding} onClick={submit}>{addLabel}</button>
            </div>
            <div id="add-split" className="splitpreview" hidden={items.length < 2 || asking}>
              {items.map((n, i) => <span className="spchip" key={i}>{n}<button type="button" data-spx={i} aria-label={`Remove ${n}`} onClick={() => dropChip(i)}>×</button></span>)}
            </div>
            <p className="muted nomargin" id="add-status">{status}</p>
            <div id="add-receipt-offer">
              {receiptFile ? <>
                <p className="nomargin" style={{ marginTop: 10 }}>This looks like a receipt.</p>
                <p style={{ marginBottom: 0 }}><button className="btn primary" id="add-file-receipt" type="button" onClick={fileReceipt}>File it as a receipt</button></p>
              </> : null}
            </div>
          </div>
          <div id="list-answer">{ask.node}</div>

          <div id="list-eyes" hidden={!eyesPending}>
            <h3 className="sect">Eyes — sightings to confirm</h3>
            <div className="group pad"><div id="eyes-records">
              {eyes.map(rec => (
                <div className="eyes-record" key={rec.id}>
                  <img src={`/eyes/photos/${rec.id}`} alt="Eyes photo" />
                  <p className="muted">{rec.kind} · {fmtDate(rec.date)}</p>
                  {rec.sightings.map((sg, i) => (
                    <div className="row" key={i}><div className="grow"><span className="name">{sg.name}</span>
                      <span className="sub">{sg.judge_agree ? "" : "two reads disagreed · "}{sg.state}</span></div>
                      {sg.state === "pending" ? <div>
                        <button className="chip eyes-confirm" type="button" onClick={() => eyeDecide(rec.id, i, "confirmed")}>Yes, it’s there</button>{" "}
                        <button className="chip eyes-reject" type="button" onClick={() => eyeDecide(rec.id, i, "rejected")}>Not there</button></div> : null}
                    </div>))}
                  <p className="nomargin" style={{ marginTop: 6 }}><button className="chip eyes-del" type="button" onClick={() => eyeDelete(rec.id)}>Delete photo</button></p>
                </div>))}
            </div></div>
          </div>

          <div id="smart-list" ref={smart} onClick={onRows} onKeyDown={onRowsKey}>
            {groceries.length ? <div className="group">{groceries.map(i => <ListRow key={i.item_id} {...rowProps(i)} />)}</div>
              : errands.length ? null
                : <div className="group pad"><div className="emptyface-wrap"><img className="emptyface" src="/assets/characters/pantry.webp" alt="" />
                  <p className="empty">Nothing on {name} yet. Type, speak or snap a list above.</p></div></div>}
            {errands.length ? <>
              <p className="grouplabel">Other errands</p>
              <div className="group">{errands.map(i => <ListRow key={i.item_id} {...rowProps(i)} />)}</div>
            </> : null}
          </div>

          <div id="list-suggest">
            {sugg.length ? <>
              <div className="sectrow"><h3 className="sect">{lid === "else" ? "Suggested" : `Suggested for ${name}`}</h3><span className="muted">Tap to see why</span></div>
              <div className="group">{sugg.map(i => {
                const c = charFor(i.name);
                return (
                  <div className="row sugrow" key={i.item_id} data-why={i.item_id} tabIndex={0} role="button" aria-label={`Why Arya suggests ${i.name}`}
                    onClick={() => setSheet({ kind: "why", id: i.item_id })}
                    onKeyDown={ev => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); setSheet({ kind: "why", id: i.item_id }); } }}>
                    {c ? <img className="rowface" src={`/assets/characters/${c}`} alt="" /> : null}
                    <div className="grow"><span className="name">{i.name}</span><span className="why"><IconSpark />{suggestWhy(i)}</span></div>
                    <button className="addchip" type="button" data-sugg-add={i.item_id} aria-label={`Add ${i.name}`}
                      onClick={ev => { ev.stopPropagation(); addSuggestion(i.item_id); }}>+ Add</button>
                  </div>);
              })}</div>
            </> : null}
          </div>

          <div id="list-done" onClick={onRows}>
            {done.length && !selEff ? (
              <div className="group">
                <div className="row donerow">
                  <button className="linkbtn donetoggle" type="button" data-done-toggle aria-expanded={doneOpen} onClick={e => { e.stopPropagation(); setDoneOpen(!doneOpen); }}>✓ {done.length} checked off {doneOpen ? "▴" : "▾"}</button>
                  <button className="linkbtn" type="button" data-done-clear onClick={e => { e.stopPropagation(); removeItems(done.map(i => i.item_id)); }}>Clear</button>
                </div>
                {doneOpen ? done.map(i => <ListRow key={i.item_id} {...rowProps(i)} />) : null}
              </div>) : null}
          </div>

          <div id="list-startbar" className="startbar" hidden={!startBar}>
            <button id="list-hunt" className="btn primary wide" type="button" onClick={() => setShopOpen(true)}>Start shopping · {open.length} item{open.length === 1 ? "" : "s"}</button>
          </div>
        </div>
      )}

      {onPage && selEff && (
        <div id="list-selbar" className="selbar">
          <button className="btn secondary dangertext" id="ls-remove" type="button" disabled={!nSel} onClick={() => removeItems([...selEff])}>Remove</button>
          <button className="btn primary" id="ls-move" type="button" disabled={!nSel} onClick={() => setSheet({ kind: "move", ids: [...selEff] })}>{nSel ? `Move ${nSel} to…` : "Move to…"}</button>
        </div>
      )}

      {data && (
        <ListSheet sheet={sheet} setSheet={setSheet} data={data} lens={effLens}
          actions={{ onCreate: createList, onSaveStores: saveStores, onDelete: deleteList, onMove: moveTo,
            onWhyAdd: addSuggestion, onWhyNot: dismissSuggestion, onWhyNever: neverSuggest }} />
      )}

      <Sheet open={shopOpen} onClose={() => setShopOpen(false)} id="shop-sheet" labelledBy="shop-title">
        <div className="sheethead"><h3 id="shop-title" className="nomargin">Shop {here ? here.name : "Everything else"} · {open.length} item{open.length === 1 ? "" : "s"}</h3><button id="shop-close" className="linkbtn" type="button" onClick={() => setShopOpen(false)}>Close</button></div>
        <div className="group shopmodes">
          <button className="hubrow" type="button" data-shop="quest" data-first onClick={() => startHunt("quest")}><img className="rowface" src="/assets/scenes/storefront.webp" alt="" /><span className="hr-label">Quest<span className="sub">A treasure hunt with points and badges</span></span><span className="chev">›</span></button>
          <button className="hubrow" type="button" data-shop="express" onClick={() => startHunt("express")}><img className="rowface" src="/assets/characters/basket.webp" alt="" /><span className="hr-label">Express<span className="sub">Just the list, with aisle help</span></span><span className="chev">›</span></button>
        </div>
        <p id="shop-sugg" className="muted shopsugg" hidden={!shopSugg.length}>
          {shopSugg.length ? <>Arya also suggests {shopSugg.slice(0, 2).map(i => i.name).join(" and ")}{shopSugg.length > 2 ? ` and ${shopSugg.length - 2} more` : ""}. <button type="button" className="linkbtn" data-shop-add onClick={addAllSuggested}>Add {shopSugg.length === 1 ? "it" : shopSugg.length === 2 ? "both" : "all"}</button></> : null}
        </p>
      </Sheet>
    </>
  );
}
