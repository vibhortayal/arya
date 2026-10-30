import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet } from "../../ui/Sheet";
import { InfoBtn, InfoSheet } from "../../ui/Info";
import { useToast } from "../../ui/Toast";
import { get, post } from "../../lib/api";
import { MONTHS, fmtShort, money } from "../../lib/format";
import { clearOnSignOut, useSession } from "../../app/session";
import { charFor } from "../../lib/characters";
import { AISLE_ORDER, GROUP_AT, OTHER } from "./aisles";
import { itemHome, namedLists, onListItems, sameStore, suggestHome, suggestWhy, type HomeData, type Item, type NamedList } from "./model";
import { useTranslation } from "../../i18n";
import { ShareWizard } from "./ShareWizard";

/* Port of pwa/lists.js: the sheets behind the Lists tab (new list,
 * list options, link stores, move, and "why Arya suggests it"). The
 * tab itself (Lists.tsx) owns the data and the writes that touch it. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TITLE_STYLE = { fontSize: 22 } as const;

const WHY_ICONS: Record<string, string> = {
  cal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.6"/></svg>`,
};
const Ic = ({ k }: { k: string }) => <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: WHY_ICONS[k] }} />;

export type SheetState =
  | { kind: "new"; moving: string[] | null }
  | { kind: "menu" }
  | { kind: "stores" }
  | { kind: "move"; ids: string[] }
  | { kind: "row"; id: string }
  | { kind: "aisle"; id: string }
  | { kind: "where"; id: string }
  | { kind: "share" }
  | { kind: "why"; id: string };

/* ---------------- store choices and the Find-a-store picker ---------------- */

type Choice = { name: string; id: string; where: string; fresh?: boolean };
type Sugg = { place_id: string; name: string; secondary: string };
type Places = { suggestions?: Sugg[]; provisioned?: boolean };

const storeWhere = (s: { street?: string; city?: string }) => [s.street, s.city].filter(Boolean).join(", ");

/* Stores a list may link to: the ones the household already has (My
 * Stores first, then the stores its receipts name). */
async function storeChoices(extra: string[] = []): Promise<Choice[]> {
  const rows: Choice[] = [];
  const add = (n: unknown, id = "", where = "") => {
    const name = String(n || "").trim();
    if (name && !rows.some(x => (id && x.id === id) || (!id && sameStore(x.name, name)))) rows.push({ name, id, where });
  };
  try { ((await get<{ stores?: any[] }>("/api/stores/mine")).stores || []).forEach(s => add(s.name, s.id, storeWhere(s))); } catch { /* none yet */ }
  try {
    const plan = await get<{ items?: { stores?: Record<string, number> }[] }>("/api/quest/plan");
    const seen: Record<string, number> = {};
    for (const i of plan.items || []) for (const [s, n] of Object.entries(i.stores || {})) seen[s] = (seen[s] || 0) + n;
    Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s]) => add(s));
  } catch { /* no history yet */ }
  extra.forEach(n => add(n));
  return rows;
}

let placesSession = "";
let geo: { lat: number; lng: number } | null = null;
clearOnSignOut(() => { placesSession = ""; geo = null; });
const session = () => placesSession || (placesSession = `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`);

function StorePicker({ extra, picked, setPicked }: { extra?: string[]; picked: string[]; setPicked: (p: string[]) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [find, setFind] = useState("");
  const [goog, setGoog] = useState<{ d: Places; head: string } | null>(null);
  const [busyPick, setBusyPick] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const findRef = useRef("");
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    storeChoices(extra).then(c => { if (alive.current) setChoices(c); });
    return () => { alive.current = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggest = async (q: string) => {
    const g = geo ? `&lat=${geo.lat}&lng=${geo.lng}` : "";
    const d = await get<Places>(`/api/stores/places?q=${encodeURIComponent(q)}&session=${session()}${g}`);
    if (!alive.current || findRef.current.trim() !== q) return; // typed on: stale
    setGoog({ d, head: t("common.fromGoogle") });
  };
  const onFind = (v: string) => {
    setFind(v); findRef.current = v;
    clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 3) { setGoog(null); return; }
    timer.current = window.setTimeout(() => suggest(q).catch(() => setGoog(null)), 300);
  };
  const nearMe = () => {
    if (!navigator.geolocation) { toast(t("common.location.cannot")); return; }
    navigator.geolocation.getCurrentPosition(p => {
      (async () => {
        try {
          geo = { lat: p.coords.latitude, lng: p.coords.longitude };
          const d = await get<Places>(`/api/stores/places?q=&lat=${geo.lat}&lng=${geo.lng}`);
          if (alive.current) setGoog({ d, head: t("common.location.nearYou") });
        } catch (e) { toast(errMsg(e)); }
      })();
    }, () => toast(t("common.location.allow")), { timeout: 8000 });
  };
  const pickPlace = async (s: Sugg) => {
    setBusyPick(s.place_id);
    try {
      const row = await post<{ id: string; name: string; street?: string; city?: string }>("/api/stores/places/pick", { place_id: s.place_id, name: s.name });
      placesSession = ""; // the pick ends Google's billing session
      if (!alive.current) return;
      setChoices(c => [{ name: row.name, id: row.id, where: storeWhere(row), fresh: true }, ...(c || []).filter(x => x.id !== row.id)]);
      if (!pickedRef.current.includes(row.name)) setPicked([...pickedRef.current, row.name]);
      setFind(""); findRef.current = ""; setGoog(null);
      toast(t("lists.stores.added", { name: row.name }));
    } catch (e) { toast(errMsg(e)); }
    setBusyPick("");
  };
  const removeStore = async (id: string) => {
    try {
      await post("/api/stores/mine/remove", { store_id: id });
      if (!alive.current) return;
      const c = (choices || []).find(x => x.id === id);
      setChoices(cs => (cs || []).filter(x => x.id !== id));
      if (c) setPicked(pickedRef.current.filter(n => n !== c.name));
      toast(c ? t("lists.stores.removed", { name: c.name }) : t("lists.stores.removedPlain"));
    } catch (e) { toast(errMsg(e)); }
  };
  const toggle = (name: string) => setPicked(picked.includes(name) ? picked.filter(n => n !== name) : [...picked, name]);

  return (
    <>
      <div className="findrow">
        <input type="text" id="ls-find" maxLength={80} placeholder={t("lists.findAStoreNameOr")} autoComplete="off" aria-label={t("lists.findAStore")}
          value={find} onChange={e => onFind(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} />
        <button className="chip" type="button" data-ls="near" onClick={nearMe}><span className="pinic" aria-hidden="true" />{t("lists.nearMe")}</button>
      </div>
      <div id="ls-goog" className="gdrop" hidden={!goog}>
        {goog && ((goog.d.suggestions || []).length
          ? <>
            <div className="ghead">{goog.head}</div>
            {(goog.d.suggestions || []).map(r => (
              <button key={r.place_id} className="gitem" type="button" data-ls-pick={r.place_id} data-ls-pname={r.name}
                disabled={busyPick === r.place_id} onClick={() => pickPlace(r)}>
                <span className="name">{r.name}</span><span className="sub">{r.secondary}</span>
              </button>))}
          </>
          : <div className="ghead">{goog.d.provisioned === false ? t("common.googleNotSetUp") : t("common.noStoresFound")}</div>)}
      </div>
      <div id="ls-stores">
        {choices && (!choices.length
          ? <p className="sub">{t("lists.noStoresYetFindOne")}</p>
          : <><p className="nearlbl">{t("lists.stores.yours")}</p>{choices.map(c => (
            <div className="srow" key={c.id || c.name}>
              <button className="navrow" type="button" data-ls-store={c.name} aria-pressed={picked.includes(c.name)} onClick={() => toggle(c.name)}>
                <span className="tick" aria-hidden="true">✓</span><span className="grow">{c.name}{c.fresh ? <span className="newtag">{t("common.new")}</span> : null}{c.where ? <small>{c.where}</small> : null}</span>
              </button>
              {c.id ? <button className="rmstore" type="button" data-ls-rm={c.id} aria-label={t("lists.stores.removeAria", { name: c.name })} onClick={() => removeStore(c.id)}>×</button> : null}
            </div>))}</>)}
      </div>
    </>
  );
}

/* ---------------- the sheets ---------------- */

type Common = {
  data: HomeData;
  lens: string;
  onClose: () => void;
  /* Each action runs its write and refreshes the tab; the sheet shows
   * any error as a toast and stays open. */
  run: (fn: () => Promise<void>) => void;
};

function NewSheet({ moving, onClose, run, onCreate }: Pick<Common, "onClose" | "run"> & { moving: string[] | null; onCreate: (name: string, stores: string[], moving: string[] | null) => Promise<void> }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const create = () => {
    const n = name.trim();
    if (!n) { toast(t("lists.giveName")); return; }
    run(() => onCreate(n, picked, moving));
  };
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{t("lists.newList")}</h3>
      <label className="field">{t("lists.name")}<input type="text" id="ls-name" maxLength={40} placeholder={t("lists.costcoIndianStoreParty")} autoComplete="off" data-first
        value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); create(); } }} /></label>
      <p className="sub">{t("lists.linkStoresOptionalFindOne")}</p>
      <StorePicker picked={picked} setPicked={setPicked} />
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" type="button" data-ls="create" onClick={create}>{t("lists.createList")}</button></div>
    </>
  );
}

function MenuSheet({ data, lens, onClose, onStores, onDelete, onShare }: Common & { onStores: () => void; onDelete: (l: NamedList) => void; onShare: () => void }) {
  const { t } = useTranslation();
  const l = namedLists(data).find(x => x.id === lens) || null;
  const n = l ? data.list.items.filter(i => i.on_list && i.list === l.id).length : 0;
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{l ? l.name : t("common.everythingElse")}</h3>
      {l ? <button className="navrow" type="button" data-ls="share" onClick={onShare}><span className="grow">{t("lists.share.menuRow")}<small>{t("lists.share.menuSub")}</small></span><span className="chev">›</span></button> : null}
      {l ? <button className="navrow" type="button" data-ls="stores" onClick={onStores}><span className="grow">{(l.stores || []).length ? t("lists.changeStores") : t("lists.linkStores")}<small>{(l.stores || []).length ? l.stores!.join(", ") : t("lists.storesUse")}</small></span><span className="chev">›</span></button> : null}
      {l ? <button className="navrow dangerrow" type="button" data-ls="delete" onClick={() => onDelete(l)}><span className="grow">{t("lists.deleteList")}<small>{n ? t("lists.deleteMoves", { count: n }) : t("lists.hasNoItems")}</small></span></button> : null}
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.done")}</button></div>
    </>
  );
}

function StoresSheet({ data, lens, onClose, run, onSave }: Common & { onSave: (id: string, stores: string[]) => Promise<void> }) {
  const { t } = useTranslation();
  const l = namedLists(data).find(x => x.id === lens);
  const [picked, setPicked] = useState<string[]>([...((l && l.stores) || [])]);
  if (!l) return null;
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{t("lists.linkStores")}</h3>
      <p className="sub">{t("lists.pickOneOrMoreHunts", { name: l.name })}</p>
      <StorePicker extra={l.stores} picked={picked} setPicked={setPicked} />
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" type="button" data-ls="savestores" onClick={() => run(() => onSave(l.id, picked))}>{t("common.save")}</button></div>
    </>
  );
}

function MoveSheet({ data, lens, ids, run, onMove, onNew }: Common & { ids: string[]; onMove: (ids: string[], listId: string) => Promise<void>; onNew: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const here = lens === "home" ? "else" : lens;
  const lists = namedLists(data);
  const count = (id: string) => data.list.items.filter(i => i.on_list && !i.checked && (id === "else"
    ? !lists.some(l => l.id === i.list) : i.list === id)).length;
  const one = ids.length === 1 ? (data.list.items.find(i => i.item_id === ids[0]) || ({} as Partial<Item>)).name : "";
  const dest = (id: string, name: string) => id === here
    ? <button key={id} className="navrow here" type="button" disabled><span className="grow">{name}<small>{t(ids.length === 1 ? "lists.itsHereNow" : "lists.theyreHereNow")}</small></span></button>
    : <button key={id} className="navrow" type="button" data-ls-move={id} onClick={() => run(() => onMove(ids, id))}><span className="grow">{name}<small>{t("common.itemCount", { count: count(id) })}</small></span><span className="chev">›</span></button>;
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{t("lists.moveTitle", { what: one ? one : t("common.itemCount", { count: ids.length }) })}</h3>
      {lists.map(l => dest(l.id, l.name))}{dest("else", t("common.everythingElse"))}
      <button className="navrow accentrow" type="button" data-ls="movenew" onClick={() => onNew(ids)}><span className="grow"><span aria-hidden="true">+ </span>{t("lists.newListMenu")}</span></button>
    </>
  );
}

const deptOf = (i: Item) => (i.aisle && AISLE_ORDER.includes(i.aisle) ? i.aisle : OTHER);

/* Pick the department an item files under. Remembered for the household. */
function AisleSheet({ data, id, run, onClose, onAisle }: Common & { id: string; onAisle: (id: string, aisle: string) => Promise<void> }) {
  const { t } = useTranslation();
  const item = data.list.items.find(i => i.item_id === id) || ({} as Partial<Item>);
  const now = deptOf(item as Item);
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{item.name || ""}</h3>
      <p className="sub">{t("lists.departmentHint")}</p>
      <div className="group" style={{ boxShadow: "none" }}>
        {[...AISLE_ORDER, OTHER].map(a => (
          <button key={a} className="navrow" type="button" data-ls-aisle={a} aria-pressed={a === now}
            onClick={() => run(async () => { onClose(); if (a !== now) await onAisle(id, a); })}>
            <span className="grow">{t(`lists.aisle.${a}`)}</span><span className="tick" aria-hidden="true">✓</span></button>))}
      </div>
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button></div>
    </>
  );
}

/* The row's ⋯ button: Move and Remove without needing the swipe. */
function RowSheet({ data, id, run, onClose, onMove, onAisle, onRemove, shopping, onWhere }: Common & { id: string; onMove: (id: string) => void; onAisle: (id: string) => void; onRemove: (ids: string[]) => Promise<void>; shopping?: boolean; onWhere: (id: string) => void }) {
  const { t } = useTranslation();
  const item = data.list.items.find(i => i.item_id === id) || ({} as Partial<Item>);
  const name = item.name || "";
  /* The department row only helps where the list shows department headers. */
  const grouped = !!item.item_id && onListItems(data).filter(i => !i.checked && !i.not_grocery && itemHome(data, i) === itemHome(data, item as Item)).length >= GROUP_AT;
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{name}</h3>
      {shopping ? <button className="navrow" type="button" data-ls="row-where" onClick={() => onWhere(id)}><span className="grow">{t("lists.whereIsIt")}<small>{t(`lists.aisle.${deptOf(item as Item)}`)}</small></span><span className="chev">›</span></button> : null}
      {!shopping ? <button className="navrow" type="button" data-ls="row-move" onClick={() => onMove(id)}><span className="grow">{t("lists.moveToAnother")}</span><span className="chev">›</span></button> : null}
      {grouped && !shopping ? <button className="navrow" type="button" data-ls="row-aisle" onClick={() => onAisle(id)}><span className="grow">{t("lists.moveToDepartment")}<small>{t(`lists.aisle.${deptOf(item as Item)}`)}</small></span><span className="chev">›</span></button> : null}
      {!shopping ? <button className="navrow dangerrow" type="button" data-ls="row-remove" onClick={() => run(async () => { onClose(); await onRemove([id]); })}><span className="grow">{t("common.remove")}</span></button> : null}
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button></div>
    </>
  );
}

/* Where? (8): what Arya knows about the aisle, and a way to help map it. */
function WhereSheet({ data, id, run, onClose, onSnap }: Common & { id: string; onSnap: (name: string) => void }) {
  const { t } = useTranslation();
  const item = data.list.items.find(i => i.item_id === id) || ({} as Partial<Item>);
  return (
    <>
      <span className="sheetgrip" />
      <h3 id="ls-title" className="largetitle" style={TITLE_STYLE}>{item.name || ""}</h3>
      <p className="sub">{t("lists.whereIn", { dept: t(`lists.aisle.${deptOf(item as Item)}`) })}</p>
      <button className="navrow" type="button" data-ls="where-snap" onClick={() => run(async () => { onClose(); onSnap(item.name || ""); })}><span className="grow">{t("lists.whereSnap")}<small>{t("lists.whereSnapSub")}</small></span><span className="chev">›</span></button>
      <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button></div>
    </>
  );
}

/* Why Arya suggests an item: rhythm (with the last 8 weeks as dots),
 * last bought, and where it is usually bought, all from receipts. */
type Hist = { event_type: string; date: string; store_id?: string };
type ItemInfo = { pattern?: { median_interval_days?: number; purchase_count: number; last_bought?: string; days_since_last?: number };
  history?: Hist[]; price_by_store?: Record<string, { count: number; median: number }> };
type Prices = { trend?: { pct: number; since_month: string; from_price: number; to_price: number; store: string };
  cheaper?: { store: string; price: number; vs_price: number; vs_store: string; date: string };
  similar?: { name: string; store: string; date: string; price: number; per_price?: number; per?: string }[];
  per_price?: number; per?: string };

function WhySheet({ data, id, onClose, onAdd, onNot, onNever }: Pick<Common, "data" | "onClose"> & { id: string; onAdd: (id: string) => void; onNot: (id: string) => void; onNever: (id: string) => void }) {
  const { t } = useTranslation();
  const { currency } = useSession();
  const $ = (n: number) => money(n, currency);
  const it = data.list.items.find(i => i.item_id === id);
  const [d, setD] = useState<ItemInfo | null>(null);
  const [pr, setPr] = useState<Prices | null>(null);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const target = it ? suggestHome(data, it) : "else";
  const tl = namedLists(data).find(l => l.id === target);
  const tname = target === "else" ? t("lists.yourList") : (tl || { name: "" }).name;
  const at = ((tl || {}).stores || [])[0] || "";

  useEffect(() => {
    let live = true;
    (async () => {
      let dd: ItemInfo | null = null, pp: Prices | null = null;
      try { dd = await get(`/api/items/${encodeURIComponent(id)}`); } catch { dd = null; }
      // Prices, from this household's receipts only.
      try { pp = await get(`/api/prices/item/${encodeURIComponent(id)}${at ? `?at=${encodeURIComponent(at)}` : ""}`); } catch { pp = null; }
      if (live) { setD(dd); setPr(pp); setReady(true); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!it || !ready) return null;
  const p = d && d.pattern;
  const hist = ((d && d.history) || []).filter(h => h.event_type === "purchase");
  const rows: ReactNode[] = [];
  if (it.expired_on) rows.push(<div className="whyrow" key="exp"><Ic k="clock" /><div><b>{t("lists.youMarkedItExpired")}</b><span className="sub">{t("lists.on", { expired_on: fmtShort(it.expired_on) })}</span></div></div>);
  if (p && p.median_interval_days) {
    const now = Date.now(), day = 864e5;
    const dots: ReactNode[] = [];
    for (let w = 7; w >= 0; w--) {
      const hi = now - w * 7 * day, lo = hi - 7 * day;
      const got = hist.some(h => { const t = new Date(h.date + "T12:00:00").getTime(); return t > lo && t <= hi; });
      dots.push(w === 0 && !got ? <i className="now" key={w} /> : <i className={got ? "" : "gap"} key={w} />);
    }
    const first = hist.length ? hist[hist.length - 1].date : null;
    rows.push(<div className="whyrow" key="rhythm"><Ic k="cal" /><div><b>{t("lists.youBuyItEveryDays", { median_interval_days: Math.round(p.median_interval_days) })}</b><span className="sub">{t("lists.time", { count: p.purchase_count })}{first ? t("lists.why.sinceMonth", { month: MONTHS[Number(first.slice(5, 7)) - 1] }) : ""}{t("lists.last8Weeks")}</span><span className="dots" aria-hidden="true">{dots}</span></div></div>);
  }
  if (p && p.last_bought) {
    const last = hist[0];
    const late = (p.days_since_last || 0) - Math.round(p.median_interval_days || 0);
    rows.push(<div className="whyrow" key="last"><Ic k="clock" /><div><b>{p.days_since_last === 0 ? t("lists.why.lastBoughtToday") : t("lists.why.lastBoughtAgo", { count: p.days_since_last })}</b><span className="sub">{fmtShort(p.last_bought)}{last && last.store_id ? t("lists.why.atStore", { store: last.store_id }) : ""}.{late > 0 ? t("lists.why.pastUsual", { count: late }) : ""}</span></div></div>);
  }
  const tr = pr && pr.trend;
  if (tr) rows.push(<div className="whyrow" key="trend"><span className="ic" aria-hidden="true"><b>{tr.pct > 0 ? "↗" : "↘"}</b></span><div><b>{t(tr.pct > 0 ? "lists.why.trendUp" : "lists.why.trendDown", { pct: Math.abs(Math.round(tr.pct)), since_month: tr.since_month })}</b><span className="sub">{t("lists.thenNowAt", { from_price: $(tr.from_price), to_price: $(tr.to_price), store: tr.store })}</span></div><InfoBtn k="trend" onOpen={setInfo} /></div>);
  const ch = pr && pr.cheaper;
  if (ch) rows.push(<div className="whyrow" key="cheaper"><Ic k="tag" /><div><b>{t("lists.cheaperAt", { store: ch.store, price: $(ch.price) })}</b><span className="sub">{t("lists.youPaidAtOn", { vs_price: $(ch.vs_price), vs_store: ch.vs_store, store: ch.store, date: fmtShort(ch.date) })}</span></div><InfoBtn k="cheaper" onOpen={setInfo} /></div>);
  const sim = (pr && pr.similar) || [];
  const perOz = (v: number, u?: string) => u === "oz" ? t("lists.why.centsPerOz", { cents: (v * 100).toFixed(1) }) : t("lists.why.each", { price: $(v) });
  if (sim.length) rows.push(<div className="whyrow" key="sim"><Ic k="tag" /><div><b>{t("lists.similarItemsYouBought")}</b>{pr!.per_price ? <span className="sub">{t("lists.thisOne", { per_price: perOz(pr!.per_price, pr!.per) })}</span> : null}{sim.map((s, i) =>
    <span className="sub simrow" key={i}><span>{s.name}<br />{s.store}, {fmtShort(s.date)}</span><span>{$(s.price)}{s.per_price ? <><br />{perOz(s.per_price, s.per)}</> : null}</span></span>)}</div><InfoBtn k="similar" onOpen={setInfo} /></div>);
  const stores = ch ? [] : Object.entries((d && d.price_by_store) || {}).sort((a, b) => b[1].count - a[1].count);
  if (stores.length) {
    const [s0, v0] = stores[0];
    const others = stores.slice(1, 3).map(([s, v]) => t("lists.why.priceAt", { price: $(v.median), store: s })).join(" · ");
    rows.push(<div className="whyrow" key="usual"><Ic k="tag" /><div><b>{t("lists.usuallyFrom", { s0, median: $(v0.median) })}</b><span className="sub">{others || t("lists.why.buysThere", { count: v0.count })}</span></div></div>);
  }
  if (!rows.length) rows.push(<div className="whyrow" key="why"><Ic k="cal" /><div><b>{suggestWhy(it)}</b>{it.judge_reason ? <span className="sub">{it.judge_reason}</span> : null}</div></div>);
  const c = charFor(it.name);
  return (
    <>
      <Sheet open onClose={onClose} id="list-sheet" labelledBy="ls-title">
        <span className="sheetgrip" />
        <div className="whyhead">{c ? <img className="popface" src={`/assets/characters/${c}`} alt="" /> : null}<div><h3 id="ls-title" className="largetitle" style={{ ...TITLE_STYLE, margin: 0 }}>{it.name}</h3><span className="sub">{t("lists.whyAryaSuggestsIt")}{target === "else" ? "" : t("lists.why.forList", { name: tname })}</span></div></div>
        {rows}
        <div className="sheetacts"><button className="btn secondary" type="button" data-ls="whynot" onClick={() => onNot(id)}>{t("common.notNow")}</button><button className="btn primary" type="button" data-ls="whyadd" onClick={() => onAdd(id)}>{tname.length <= 10 ? t("lists.addTo", { name: tname }) : t("lists.addToList")}</button></div>
        <p className="nomargin whynever"><button className="linkbtn" type="button" data-ls="whynever" onClick={() => onNever(id)}>{t("lists.neverSuggestThis")}</button></p>
      </Sheet>
      <InfoSheet k={info} onClose={() => setInfo(null)} />
    </>
  );
}

export type SheetActions = {
  onCreate: (name: string, stores: string[], moving: string[] | null) => Promise<void>;
  onSaveStores: (id: string, stores: string[]) => Promise<void>;
  onDelete: (l: NamedList) => void;
  onMove: (ids: string[], listId: string) => Promise<void>;
  onWhyAdd: (id: string) => void;
  onWhyNot: (id: string) => void;
  onWhyNever: (id: string) => void;
  onRemove: (ids: string[]) => Promise<void>;
  onAisle: (id: string, aisle: string) => Promise<void>;
  /* Just my list (8): the shopping view trims the row menu to Where?. */
  shopping?: boolean;
  onSnap?: (name: string) => void;
  onChanged?: () => void;
};

export function ListSheet({ sheet, setSheet, data, lens, actions }:
  { sheet: SheetState | null; setSheet: (s: SheetState | null) => void; data: HomeData; lens: string; actions: SheetActions }) {
  const { toast } = useToast();
  const onClose = () => setSheet(null);
  const run = (fn: () => Promise<void>) => { fn().catch(e => toast(errMsg(e))); };
  if (!sheet) return null;
  if (sheet.kind === "why") {
    return <WhySheet data={data} id={sheet.id} onClose={onClose}
      onAdd={id => { onClose(); actions.onWhyAdd(id); }} onNot={id => { onClose(); actions.onWhyNot(id); }} onNever={id => { onClose(); actions.onWhyNever(id); }} />;
  }
  const common = { data, lens, onClose, run };
  return (
    <Sheet open onClose={onClose} id="list-sheet" labelledBy="ls-title" focusKey={sheet.kind}>
      {sheet.kind === "new" && <NewSheet moving={sheet.moving} onClose={onClose} run={run} onCreate={actions.onCreate} />}
      {sheet.kind === "menu" && <MenuSheet {...common} onStores={() => setSheet({ kind: "stores" })} onDelete={actions.onDelete} onShare={() => setSheet({ kind: "share" })} />}
      {sheet.kind === "share" && <ShareWizard data={data} listId={lens} listName={(namedLists(data).find(x => x.id === lens) || { name: "" }).name} onClose={onClose} onChanged={() => actions.onChanged && actions.onChanged()} />}
      {sheet.kind === "stores" && <StoresSheet {...common} onSave={actions.onSaveStores} />}
      {sheet.kind === "row" && <RowSheet {...common} id={sheet.id} onMove={id => setSheet({ kind: "move", ids: [id] })} onAisle={id => setSheet({ kind: "aisle", id })} onRemove={actions.onRemove} shopping={actions.shopping} onWhere={id => setSheet({ kind: "where", id })} />}
      {sheet.kind === "where" && <WhereSheet {...common} id={sheet.id} onSnap={name => actions.onSnap && actions.onSnap(name)} />}
      {sheet.kind === "aisle" && <AisleSheet {...common} id={sheet.id} onAisle={actions.onAisle} />}
      {sheet.kind === "move" && <MoveSheet {...common} ids={sheet.ids} onMove={actions.onMove} onNew={ids => setSheet({ kind: "new", moving: ids })} />}
    </Sheet>
  );
}
