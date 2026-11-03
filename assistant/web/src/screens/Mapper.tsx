import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { FindStorePanel } from "./StoresFind";
import { ScanStatus, UploadWalk } from "./MapScanStatus";
import { Trans, useTranslation } from "../i18n";
import { hereAt, judge, quietGeo, type Here } from "../lib/geo";
import { storeModel, useStoreData } from "../lib/stores";
import { SceneView } from "../ui/Scene";

const MapperWorld = lazy(() => import("./MapperWorld"));

/* Port of pwa/index.html #view-mapper and pwa/mapper.js (renderMapper,
 * paintMapper, focus toggle, add aisle, teach-walk start, open segment).
 * The capture itself lives on the Capture screen: this one opens it with
 * nav.show("capture", { prompt, store }). The Shell already renders
 * <section id="view-mapper">; no second one. */

type Prompt = { title: string; why?: string; est_seconds?: number; segment?: string; [k: string]: unknown };
type Seg = { id: string; label: string; side: string; status: "unmapped" | "mapped" | "aging" | "stale";
  contributors: number; stale_item?: number };
type MapView = {
  /* coverage_pct is null while the store's size is unknown (no aisle
   * number read yet): then only the sections seen are shown. */
  store?: string; total: number; coverage_pct: number | null; seen: number; aisles: number; expected: number | null;
  counts: { mapped: number; aging: number; stale: number; unmapped: number };
  goal?: { sections_needed: number; pct: number } | null;
  credit?: { title?: string; points?: number };
  next?: Prompt | null; segments: Seg[]; focus?: string[];
};
type Mine = { id?: string; name: string; favorite?: boolean; street?: string; city?: string; lat?: number | null; lng?: number | null;
  scene?: string; aisles?: number };

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

const BagSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z" /><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2" /></svg>
);

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
  const [allStores, setAllStores] = useState(false);
  const [uploading, setUploading] = useState(false);
  /* Page order (owner-approved mockup, 2026-11-03): the picked store
   * with Change, the next step right under it, then Aisles. The store
   * list and Find a store show only after Change, or with no store. */
  const [changing, setChanging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(false);
  useStoreData();
  /* The live walk needs the phone at the store (owner, 2026-11-03).
   * null: not checked yet. The position is compared and dropped. */
  const [here, setHere] = useState<Here | "checking" | null>(null);
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
  if (store && !names.includes(store)) names.unshift(store);
  /* Store cards (owner, 2026-10-30: chips were hard to see): three at a
   * time, the picked one always among them; the rest behind Show all. */
  const SHOWN = 3;
  const top = names.slice(0, SHOWN);
  const shown = allStores || names.length <= SHOWN ? names : !store || top.includes(store) ? top : [...top.slice(0, SHOWN - 1), store];
  const where = (n: string) => { const m = mine.find(s => s.name === n); return [m?.street, m?.city].filter(Boolean).join(", "); };
  const pick = (n: string) => {
    chosen = n; setStore(n); setView(null); setChanging(false); setAdding(false);
    // The next step must be in view, even after a pick far down the results.
    try { window.scrollTo({ top: 0 }); } catch { /* old browsers */ }
    load(n).catch(showErr);
  };

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

  const place = mine.find(m => m.name === store);
  const isTown = !!place?.id?.startsWith("town-");
  const checkHere = async () => {
    if (!place) { setHere("unsure"); return; }
    setHere("checking");
    setHere(await hereAt(place));
  };
  /* A store changes: read the position only when the browser already
   * allows it, so opening Map my store never opens a prompt. */
  useEffect(() => {
    setHere(null);
    if (!place || isTown) return;
    let live = true;
    quietGeo().then(g => { if (live && g) setHere(judge(g, place)); }).catch(() => {});
    return () => { live = false; };
  }, [store, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveOk = isTown || here === "near";
  /* A store with no map location: the live walk can't be checked, so
   * only Upload is offered (no Check again). */
  const noPlace = !!place && !isTown && (place.lat == null || place.lng == null);
  const tags = (m?: Mine) => [m?.aisles ? t("mapper.aislesMapped", { count: m.aisles }) : "",
    m?.scene === "cloud" ? t("storesMine.scene.cloud") : ""].filter(Boolean);
  const model = store ? storeModel(store, place?.id) : null;
  /* View map shows wherever the "Map view" tag does (scene "cloud"):
   * the store's point cloud when one has shipped, else the Quest
   * store world. */
  const hasView = place?.scene === "cloud" || !!model;

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
      setAdding(false);
      toast(out.created ? t("mapper.addedTeach") : t("mapper.alreadyHas"));
      await load(store);
    } catch (e) { toast(msg(e)); }
  };

  const v = view;
  const focusSet = new Set(focus);

  return (
    <>
      <p className="backrow"><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("common.teachAryaYourStore")}</h1>
      {store && !changing ? (
        <>
          <h3 className="sect" id="mp-select">{t("mapper.yourStore")}</h3>
          <div id="mp-picked" className="mp-store mp-picked" aria-pressed="true">
            <span className="mp-store-ic" aria-hidden="true"><BagSvg /></span>
            <span className="mp-store-t"><span className="name">{store}</span>{where(store) && <span className="sub">{where(store)}</span>}
              {tags(place).length > 0 && <span className="mp-tags">{tags(place).map(x => <span key={x} className="mp-tag">{x}</span>)}</span>}</span>
            <button className="linkbtn" id="mp-change" type="button" onClick={() => { setChanging(true); setAllStores(true); }}>{t("mapper.change")}</button>
          </div>
          {hasView && <button className="hubrow mp-viewmap" id="mp-viewmap" type="button" onClick={() => setViewing(true)}>
            <span className="hr-label">{t("mapper.viewMap")}</span><span className="chev" aria-hidden="true">›</span></button>}
        </>
      ) : (
        <>
          <h3 className="sect" id="mp-select">{t("mapper.selectStore")}</h3>
          <div id="mp-stores" className="mp-stores">
            {shown.map(n => {
              const m = mine.find(x => x.name === n);
              return (
                <button key={n} className="mp-store" data-mstore={n} aria-pressed={n === store} type="button" onClick={() => pick(n)}>
                  <span className="mp-store-ic" aria-hidden="true"><BagSvg /></span>
                  <span className="mp-store-t"><span className="name">{n}</span>{where(n) && <span className="sub">{where(n)}</span>}
                    {tags(m).length > 0 && <span className="mp-tags">{tags(m).map(x => <span key={x} className="mp-tag">{x}</span>)}</span>}</span>
                  <span className="mp-store-r" aria-hidden="true">{n === store ? "✓" : ""}</span>
                </button>
              );
            })}
            {shown.length < names.length && (
              <button className="linkbtn mp-allstores" type="button" onClick={() => setAllStores(true)}>{t("mapper.showAllStores", { count: names.length })}</button>
            )}
          </div>
          <h3 className="sect">{t("mapper.findMyStore")}</h3>
          <div id="mp-find">
            <FindStorePanel onAdded={n => { setAllStores(true); pick(n); }} />
          </div>
        </>
      )}
      {store && <ScanStatus store={store} onMapChanged={() => { load(store).catch(() => {}); }} />}
      {uploading && store && <UploadWalk store={store} onClose={() => setUploading(false)} />}
      <div id="mp-walk">
        {v && store && !changing && (
          <div className="group pad mp-nextcard">
            {liveOk ? (
              <>
                <p className="muted nomargin" id="mp-here" role="status">{isTown ? t("mapper.here.demo") : t("mapper.here.near")}</p>
                <button className="btn primary wide" id="mp-walkstart" type="button" onClick={startWalk}>{t(v.total ? "mapper.keepMappingAt" : "mapper.startMappingAt", { store })}</button>
                <p className="muted nomargin mp-howto">{t("mapper.howTo")}</p>
                <button className="btn wide mp-upload" id="mp-upload" type="button" onClick={() => setUploading(true)}>{t("mapScan.uploadButton")}</button>
              </>
            ) : noPlace ? (
              <>
                <p className="muted nomargin" id="mp-here" role="status">{t("mapper.here.noPlace")}</p>
                <button className="btn primary wide mp-upload" id="mp-upload" type="button" onClick={() => setUploading(true)}>{t("mapScan.uploadButton")}</button>
              </>
            ) : (
              <>
                <p className="muted nomargin" id="mp-here" role="status">{t(here === "denied" ? "mapper.here.denied" : here === "far" || here === "unsure" ? "mapper.here.cant" : "mapper.here.ask")}</p>
                <button className="btn primary wide mp-upload" id="mp-upload" type="button" onClick={() => setUploading(true)}>{t("mapScan.uploadButton")}</button>
                <button className="btn wide" id="mp-check" type="button" disabled={here === "checking"} onClick={() => { checkHere().catch(showErr); }}>{t(here === null ? "mapper.here.check" : here === "checking" ? "mapper.here.checking" : "mapper.here.again")}</button>
              </>
            )}
          </div>
        )}
      </div>
      {!store && <div className="group pad"><Empty>{t("mapper.pickAStoreFromMy")}</Empty></div>}
      {v && store && !changing && (
        <>
          <h3 className="sect">{t("mapper.aisles")}</h3>
          {v.total > 0 && (
            <div id="mp-cover" className="mp-cover">
              {v.coverage_pct === null ? (
                <div className="mp-count"><Trans i18nKey="mapper.seenOnly" count={v.seen} values={{ count: v.seen, store: v.store || store }} components={{ b: <strong /> }} /></div>
              ) : (
                <>
                  <div className="mp-count"><Trans i18nKey="mapper.coverage" values={{ seen: v.seen, expected: v.expected, aisles: v.aisles }} components={{ b: <strong />, m: <span className="muted" /> }} /></div>
                  <div className="track" aria-hidden="true"><span className="bar" style={{ width: `${v.coverage_pct}%` }} /></div>
                </>
              )}
              <p className="muted nomargin">{v.coverage_pct === null ? t("mapper.sizeUnknown") : ""}{v.counts.aging ? t("mapper.countAging", { n: v.counts.aging }) : ""}{v.counts.stale ? t("mapper.countStale", { n: v.counts.stale }) : ""}{v.counts.unmapped ? t("mapper.countNew", { n: v.counts.unmapped }) : ""}{t("mapper.teachTheAislesYouUse")}</p>
              <div className="mp-me"><span className="muted">{v.goal
                ? t("mapper.goal", { count: v.goal.sections_needed, pct: v.goal.pct })
                : v.coverage_pct !== null && v.coverage_pct >= 100 ? t("mapper.knowsWholeStore") : ""}</span>
                {v.credit?.title ? <span><Trans i18nKey="mapper.credit" values={{ title: v.credit.title, points: v.credit.points }} components={{ b: <strong /> }} /></span> : null}</div>
            </div>
          )}
          <div id="mp-segs" className="group">
            {v.segments.length ? v.segments.map(s => {
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
            }) : (
              <div className="row mp-empty" id="mp-empty"><div className="grow"><span className="name">{t("mapper.nothingMappedYet")}</span>
                <span className="sub">{t("mapper.walkOrAdd")}</span></div></div>
            )}
            {v.next && (
              <div className="row mp-nextrow" id="mp-next"><div className="grow"><span className="name">{t("mapper.nextUp", { title: v.next.title })}</span>
                {v.next.why && <span className="sub">{v.next.why}</span>}</div>
                <button className="btn" id="mp-start" type="button" onClick={() => openCapture(v.next!)}>{t("mapper.cameraS", { est_seconds: v.next.est_seconds })}</button></div>
            )}
            {adding ? (
              <div className="pad mp-addform" id="mp-addform">
                <label className="field">{t("mapper.addAnAisle")}<input type="text" id="mp-label" placeholder={t("mapper.aisle4FrozenDairyWall")} autoComplete="off" maxLength={60}
                  value={label} onChange={e => setLabel(e.target.value)} autoFocus />
                </label>
                <div className="rail" id="mp-side">
                  {SIDES.map(([k, key]) => (
                    <button key={k} className="chip" data-side={k} aria-pressed={side === k} type="button" onClick={() => setSide(k)}>{t(key)}</button>
                  ))}
                </div>
                <p><button id="mp-add" className="btn wide" type="button" onClick={addAisle}>{t("mapper.addThisAisle")}</button></p>
              </div>
            ) : (
              <button className="row mp-addrow" id="mp-addrow" type="button" onClick={() => setAdding(true)}>
                <span className="mp-mine" aria-hidden="true">+</span><span className="grow name">{t("mapper.addAnAisle")}</span></button>
            )}
          </div>
        </>
      )}
      <details className="group pad mp-how" id="mp-how">
        <summary>{t("mapper.howItWorks")}</summary>
        <img className="mapperhero" src="/assets/scenes/storefront.webp" alt="" />
        <p className="muted">{t("mapper.theMoreOfYourStore")}</p>
        <p className="muted">{t("mapper.justWalkTheAislesYou")}</p>
      </details>
      {viewing && hasView && (
        <div className="mp-scene" role="dialog" aria-modal="true" aria-label={t("mapper.viewMap")}>
          <div className="mp-scenebar"><b>{t("mapper.mapOf", { store })}</b>
            <button className="linkbtn" id="mp-scenedone" type="button" onClick={() => setViewing(false)}>{t("common.done")}</button></div>
          {model ? <SceneView className="storeview mp-sceneview" driver="cloud" photos={null} model={model} stops={[]} next={-1} />
            : <div className="mp-sceneview mp-world"><Suspense fallback={<p className="mp-scenewait">{t("mapper.drawing")}</p>}>
              <MapperWorld id={place?.id} name={store} where={where(store)} /></Suspense></div>}
          <p className="mp-scenecap">{t("mapper.sceneCap")}</p>
        </div>
      )}
      <p className="muted">{t("mapper.weBlurEveryPersonBefore")}</p>
    </>
  );
}
