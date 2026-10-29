import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { useTranslation } from "../i18n";

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

const STATUS: Record<Seg["status"], [string, string]> = {
  unmapped: ["New to Arya", "st-none"],
  mapped: ["Mapped", "st-ok"],
  aging: ["Getting old", "st-age"],
  stale: ["Out of date", "st-stale"],
};
const SIDES: [string, string][] = [["left", "Left side"], ["right", "Right side"], ["both", "Both sides"]];

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
    title: `Walk ${store}`,
    why: "Just walk the aisles you shop. Arya reads the shelves and builds the map — nothing to type, no aisles to name.",
    steps: ["Hold the phone upright at chest height, shelves in view.",
            "Walk slowly, the way you shop.",
            "Pass the aisles you use. Skip the rest — other shoppers fill them in.",
            "Tap Done at the end. Arya names each section it saw, and you check them."] });

  const addAisle = async () => {
    const l = label.trim();
    if (!l) { toast("Name the aisle first."); return; }
    try {
      const out = await post("/api/storemap/segments", { store, label: l, side });
      setLabel("");
      toast(out.created ? "Added. Open the camera to teach it." : "Arya already has that aisle.");
      await load(store);
    } catch (e) { toast(msg(e)); }
  };

  const v = view;
  const focusSet = new Set(focus);

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.teachAryaYourStore")}</h2>
      <img className="mapperhero" src="/assets/scenes/storefront.webp" alt="" />
      <p className="muted">{t("mapper.theMoreOfYourStore")}</p>
      <div id="mp-stores" className="rail">
        {names.map(n => (
          <button key={n} className="chip" data-mstore={n} aria-pressed={n === store} type="button"
            onClick={() => { chosen = n; setStore(n); setView(null); load(n).catch(showErr); }}>{n}</button>
        ))}
      </div>
      <div id="mp-cover" className="group pad">
        {!store ? <Empty>{t("mapper.pickAStoreFromMy")}</Empty> : v && (v.total ? (
          <>
            <div className="mp-count">{t("mapper.aryaKnows")}{" "}<strong>{v.coverage_pct}%</strong>{" "}{t("mapper.of")}{" "}{v.store || store} <span className="muted">{t("mapper.ofSections", { mapped: v.counts.mapped, total: v.total })}</span></div>
            <div className="track" aria-hidden="true"><span className="bar" style={{ width: `${v.coverage_pct}%` }} /></div>
            <p className="muted nomargin">{v.counts.aging ? `${v.counts.aging} getting old. ` : ""}{v.counts.stale ? `${v.counts.stale} reported out of date. ` : ""}{v.counts.unmapped ? `${v.counts.unmapped} still new to Arya. ` : ""}{t("mapper.teachTheAislesYouUse")}</p>
            <div className="mp-me"><span className="muted">{v.goal
              ? `${v.goal.sections_needed} more section${v.goal.sections_needed === 1 ? "" : "s"} and Arya knows ${v.goal.pct}%`
              : "Arya knows this whole store."}</span>
              {v.credit?.title ? <span><strong>{v.credit.title}</strong>{" "}{t("mapper.pts", { points: v.credit.points })}</span> : null}</div>
          </>
        ) : <p className="nomargin">{t("mapper.noAislesHereYetWalk")}</p>)}
      </div>
      <div id="mp-walk">
        {v && store && (
          <div className="group pad mp-nextcard">
            <span className="eyebrow">{t("mapper.zeroTyping")}</span>
            <div className="name">{t("mapper.walkYourStore")}</div>
            <p className="muted">{t("mapper.justWalkTheAislesYou")}</p>
            <button className="btn primary wide" id="mp-walkstart" type="button" onClick={startWalk}>{t("mapper.startTheWalk")}</button>
          </div>
        )}
      </div>
      <div id="mp-next">
        {v && store && (v.next ? (
          <div className="group pad mp-nextcard">
            <span className="eyebrow">{t("mapper.teachAryaNext")}</span>
            <div className="name">{v.next.title}</div>
            <p className="muted">{v.next.why}</p>
            <button className="btn primary wide" id="mp-start" type="button" onClick={() => openCapture(v.next!)}>{t("mapper.openCameraAboutS", { est_seconds: v.next.est_seconds })}</button>
          </div>
        ) : v.total ? (
          <div className="group pad"><p className="nomargin">{t("mapper.aryaKnowsEveryAisleYou")}</p></div>
        ) : null)}
      </div>
      <h3 className="sect">{t("mapper.aisles")}</h3>
      <div id="mp-segs" className="group">
        {v && store && (v.segments.length ? v.segments.map(s => {
          const [text, cls] = STATUS[s.status];
          const on = focusSet.has(s.id);
          const sub = [s.side === "both" ? "both sides" : s.side + " side",
            s.contributors > 1 ? `${s.contributors} shoppers` : "",
            s.stale_item ? `${s.stale_item} not found` : ""].filter(Boolean).join(" · ");
          return (
            <div className="row mp-seg" key={s.id}>
              <button className={"mp-mine" + (on ? " on" : "")} data-mfocus={s.id} aria-pressed={on}
                aria-label={on ? "Remove from my aisles" : "Add to my aisles"} type="button"
                onClick={() => toggleFocus(s.id)}>{on ? "Mine" : "+"}</button>
              <button className="grow mp-open" data-mseg={s.id} type="button" onClick={() => openSegment(s.id)}>
                <span className="name">{s.label}</span><span className="sub">{sub}</span></button>
              <span className={"mp-st " + cls}>{text}</span>
            </div>
          );
        }) : <Empty>{t("mapper.nothingMappedYet")}</Empty>)}
      </div>
      <details className="group pad">
        <summary>{t("mapper.fineTuneAddAnAisle")}</summary>
        <label className="field">{t("mapper.addAnAisle")}<input type="text" id="mp-label" placeholder={t("mapper.aisle4FrozenDairyWall")} autoComplete="off" maxLength={60}
            value={label} onChange={e => setLabel(e.target.value)} />
        </label>
        <div className="rail" id="mp-side">
          {SIDES.map(([k, t]) => (
            <button key={k} className="chip" data-side={k} aria-pressed={side === k} type="button" onClick={() => setSide(k)}>{t}</button>
          ))}
        </div>
        <p><button id="mp-add" className="btn wide" type="button" onClick={addAisle}>{t("mapper.addThisAisle")}</button></p>
      </details>
      <p className="muted">{t("mapper.weBlurEveryPersonBefore")}</p>
    </>
  );
}
