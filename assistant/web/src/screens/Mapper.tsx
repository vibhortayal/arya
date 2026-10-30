import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { FindStorePanel } from "./StoresFind";
import { Trans, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-mapper and pwa/mapper.js (renderMapper,
 * paintMapper, focus toggle, add aisle, teach-walk start, open segment).
 * The capture itself lives on the Capture screen: this one opens it with
 * nav.show("capture", { prompt, store }). The Shell already renders
 * <section id="view-mapper">; no second one. */

type Prompt = { title: string; why?: string; est_seconds?: number; segment?: string; [k: string]: unknown };
type Seg = { id: string; label: string; side: string; status: "unmapped" | "mapped" | "aging" | "stale";
  contributors: number; stale_item?: number };
type MapView = {
  store?: string; total: number; coverage_pct: number;
  counts: { mapped: number; aging: number; stale: number; unmapped: number };
  goal?: { sections_needed: number; pct: number } | null;
  credit?: { title?: string; points?: number };
  next?: Prompt | null; segments: Seg[]; focus?: string[];
};
type Mine = { name: string; favorite?: boolean };

/* Status and side names are en.json keys. */
const STATUS: Record<Seg["status"], [string, string]> = {
  unmapped: ["mapper.status.unmapped", "st-none"],
  mapped: ["mapper.status.mapped", "st-ok"],
  aging: ["mapper.status.aging", "st-age"],
  stale: ["mapper.status.stale", "st-stale"],
};
const SIDES: [string, string][] = [["left", "mapper.side.left"], ["right", "mapper.side.right"], ["both", "mapper.side.both"]];

/* The old M.store: the chosen store survives leaving and re-opening. */
let chosen = "";
clearOnSignOut(() => { chosen = ""; });

const q = (s: string) => encodeURIComponent(s);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Mapper() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [mine, setMine] = useState<Mine[]>([]);
  const [store, setStore] = useState("");
  const [view, setView] = useState<MapView | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [side, setSide] = useState("both");
  const [label, setLabel] = useState("");
  // Find or add a store right here (owner 2026-10-29): open on its own
  // when My Stores is empty, since there is nothing else to pick.
  const [finding, setFinding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const paramStore = typeof nav.params.store === "string" ? nav.params.store : "";

  /* renderMapper: load My Stores, pick the store, read its map. */
  const load = useCallback(async (pick?: string) => {
    const n = ++seq.current;
    let list: Mine[] = [];
    try { list = (await get("/api/stores/mine")).stores || []; } catch { /* keep an empty list */ }
    if (n !== seq.current) return;
    const fav = list.find(s => s.favorite) || list[0];
    const s = pick || chosen || (fav ? fav.name : "");
    chosen = s;
    setMine(list);
    setLoaded(true);
    setStore(s);
    if (!s) { setView(null); return; }
    const v: MapView = await get(`/api/storemap?store=${q(s)}`);
    if (n !== seq.current) return;
    setView(v);
    setFocus(v.focus || []);
  }, []);

  useEffect(() => {
    if (paramStore) chosen = paramStore;
    load().catch(showErr);
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = [...new Set(mine.map(s => s.name))];
  const showFind = finding || (loaded && !mine.length);
  if (store && !names.includes(store)) names.unshift(store);

  const openCapture = (prompt: Prompt) => nav.show("capture", { prompt, store, from: "mapper" });

  const toggleFocus = async (id: string) => {
    try {
      const cur = new Set(focus);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      const out = await post("/api/storemap/focus", { store, segments: [...cur] });
      const v: MapView = await get(`/api/storemap?store=${q(store)}`);
      setView(v);
      setFocus(out.focus);
    } catch (e) { toast(msg(e)); }
  };

  const openSegment = async (id: string) => {
    try {
      const out = await get(`/api/storemap/next?store=${q(store)}&segment=${q(id)}`);
      if (out.prompt) openCapture(out.prompt);
    } catch (e) { toast(msg(e)); }
  };

  /* Zero-entry teach: the walk IS the form. */
  const startWalk = () => openCapture({ kind: "walk", segment: "", teach: true, est_seconds: 30,
    title: t("mapper.walk.title", { store }),
    why: t("mapper.walk.why"),
    steps: [t("mapper.walk.step1"), t("mapper.walk.step2"), t("mapper.walk.step3"), t("mapper.walk.step4")] });

  const addAisle = async () => {
    const l = label.trim();
    if (!l) { toast(t("mapper.nameFirst")); return; }
    try {
      const out = await post("/api/storemap/segments", { store, label: l, side });
      setLabel("");
      toast(out.created ? t("mapper.addedTeach") : t("mapper.alreadyHas"));
      await load(store);
    } catch (e) { toast(msg(e)); }
  };

  const v = view;
  const focusSet = new Set(focus);

  return (
    <>
      <p className="backrow"><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.teachAryaYourStore")}</h2>
      <h3 className="sect" id="mp-select">{t("mapper.selectStore")}</h3>
      <div id="mp-stores" className="rail">
        {names.map(n => (
          <button key={n} className="chip" data-mstore={n} aria-pressed={n === store} type="button"
            onClick={() => { chosen = n; setStore(n); setView(null); setFinding(false); load(n).catch(showErr); }}>{n}</button>
        ))}
        <button id="mp-findstore" className="chip" type="button" aria-expanded={showFind}
          onClick={() => setFinding(!showFind)}><span aria-hidden="true">+ </span>{t("mapper.findAnotherStore")}</button>
      </div>
      {showFind && (
        <div id="mp-find">
          <FindStorePanel onAdded={n => { chosen = n; setFinding(false); setView(null); load(n).catch(showErr); }} />
        </div>
      )}
      <div id="mp-walk">
        {v && store && (
          <div className="group pad mp-nextcard">
            <button className="btn primary wide" id="mp-walkstart" type="button" onClick={startWalk}>{t("mapper.startMapping")}</button>
            <p className="muted nomargin mp-howto">{t("mapper.howTo")}</p>
          </div>
        )}
      </div>
      <details className="mp-how" id="mp-how">
        <summary>{t("mapper.howItWorks")}</summary>
        <img className="mapperhero" src="/assets/scenes/storefront.webp" alt="" />
        <p className="muted">{t("mapper.theMoreOfYourStore")}</p>
        <p className="muted">{t("mapper.justWalkTheAislesYou")}</p>
      </details>
      <div id="mp-cover" className="group pad">
        {!store ? <Empty>{t("mapper.pickAStoreFromMy")}</Empty> : v && (v.total ? (
          <>
            <div className="mp-count"><Trans i18nKey="mapper.coverage" values={{ pct: v.coverage_pct, store: v.store || store, mapped: v.counts.mapped, total: v.total }} components={{ b: <strong />, m: <span className="muted" /> }} /></div>
            <div className="track" aria-hidden="true"><span className="bar" style={{ width: `${v.coverage_pct}%` }} /></div>
            <p className="muted nomargin">{v.counts.aging ? t("mapper.countAging", { n: v.counts.aging }) : ""}{v.counts.stale ? t("mapper.countStale", { n: v.counts.stale }) : ""}{v.counts.unmapped ? t("mapper.countNew", { n: v.counts.unmapped }) : ""}{t("mapper.teachTheAislesYouUse")}</p>
            <div className="mp-me"><span className="muted">{v.goal
              ? t("mapper.goal", { count: v.goal.sections_needed, pct: v.goal.pct })
              : t("mapper.knowsWholeStore")}</span>
              {v.credit?.title ? <span><Trans i18nKey="mapper.credit" values={{ title: v.credit.title, points: v.credit.points }} components={{ b: <strong /> }} /></span> : null}</div>
          </>
        ) : <p className="nomargin">{t("mapper.noAislesHereYetWalk")}</p>)}
      </div>
      <div id="mp-next">
        {v && store && (v.next ? (
          <div className="group pad mp-nextcard">
            <span className="eyebrow">{t("mapper.teachAryaNext")}</span>
            <div className="name">{v.next.title}</div>
            <p className="muted">{v.next.why}</p>
            <button className="btn wide" id="mp-start" type="button" onClick={() => openCapture(v.next!)}>{t("mapper.openCameraAboutS", { est_seconds: v.next.est_seconds })}</button>
          </div>
        ) : v.total ? (
          <div className="group pad"><p className="nomargin">{t("mapper.aryaKnowsEveryAisleYou")}</p></div>
        ) : null)}
      </div>
      <h3 className="sect">{t("mapper.aisles")}</h3>
      <div id="mp-segs" className="group">
        {v && store && (v.segments.length ? v.segments.map(s => {
          const [statusKey, cls] = STATUS[s.status];
          const on = focusSet.has(s.id);
          const sub = [s.side === "both" ? t("mapper.bothSides") : t("mapper.oneSide", { side: s.side }),
            s.contributors > 1 ? t("mapper.shoppers", { count: s.contributors }) : "",
            s.stale_item ? t("mapper.notFound", { item: s.stale_item }) : ""].filter(Boolean).join(" · ");
          return (
            <div className="row mp-seg" key={s.id}>
              <button className={"mp-mine" + (on ? " on" : "")} data-mfocus={s.id} aria-pressed={on}
                aria-label={on ? t("mapper.removeMine") : t("mapper.addMine")} type="button"
                onClick={() => toggleFocus(s.id)}>{on ? t("mapper.mine") : "+"}</button>
              <button className="grow mp-open" data-mseg={s.id} type="button" onClick={() => openSegment(s.id)}>
                <span className="name">{s.label}</span><span className="sub">{sub}</span></button>
              <span className={"mp-st " + cls}>{t(statusKey)}</span>
            </div>
          );
        }) : <Empty>{t("mapper.nothingMappedYet")}</Empty>)}
      </div>
      <details className="group pad" id="mp-more">
        <summary>{t("mapper.more")}</summary>
        <label className="field">{t("mapper.addAnAisle")}<input type="text" id="mp-label" placeholder={t("mapper.aisle4FrozenDairyWall")} autoComplete="off" maxLength={60}
            value={label} onChange={e => setLabel(e.target.value)} />
        </label>
        <div className="rail" id="mp-side">
          {SIDES.map(([k, key]) => (
            <button key={k} className="chip" data-side={k} aria-pressed={side === k} type="button" onClick={() => setSide(k)}>{t(key)}</button>
          ))}
        </div>
        <p><button id="mp-add" className="btn wide" type="button" onClick={addAisle}>{t("mapper.addThisAisle")}</button></p>
      </details>
      <p className="muted">{t("mapper.weBlurEveryPersonBefore")}</p>
    </>
  );
}
