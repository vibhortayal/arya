/* A trip in progress: one living store. Your shopper walks to an item,
 * then you choose what happens (look first, grab later): Grab it, Not
 * here, Substitute or Skip. Nothing enters the cart until you choose,
 * and nothing moves on until you pick the next stop. The reducer owns
 * the rules; this screen dispatches actions and plays their events. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { routeNote } from "../core/route";
import { artFor, type QuestSource } from "../core/source";
import { sectionFor } from "../core/template";
import {
  SCORE, allHandled, currentStop, isHandled, itemsIn, leftIn, liveStops, reduce, sectionView, stops,
  type Action, type GameEvent, type Trip,
} from "../core/trip";
import type { QuestItem } from "../core/types";
import { buzz, chime, feel, goldChime, say, soft, stinger, tick, whoosh, type FeelPrefs } from "../fx/feel";
import { Juice } from "../fx/juice";
import { charArt, sceneArt } from "../assets";
import { GhostHand, Sheet, SnapButton } from "./bits";
import { coachFor } from "./coach";
import type { Goal, WorldApi } from "../world/World3D";

const World3D = lazy(() => import("../world/World3D").then(m => ({ default: m.World3D })));

type Props = { trip: Trip; source: QuestSource; avatar?: string | null; onTrip: (t: Trip) => void; onFinish: (t: Trip) => void; onQuit: () => void;
  /* End the trip for good (the host closes its record). */
  onEnd?: () => void;
  /* A store not fully mapped: the cue's Map it opens a sheet whose
   * "Map it now" leaves for the host's Map my store (QuestGame.needsMap). */
  onMap?: () => void };
type SheetName = null | "list" | "map" | "help" | "quit";
type Page = "main" | "nothere" | "staff" | "sub";
type Banner = null | { title: string; sub?: string; kind: "clear" | "sweep" | "map" };
/* The fog nudge (owner, 2026-10-30: a small nudge while shopping is
 * fine, never the whole screen): after a find in a section Arya has not
 * located, one line beside the map button offers a shelf photo. */
type Nudge = null | { section: string; item: string; state: "ask" | "busy" | "done" | "fail"; note?: string };

export function Play({ trip, source, avatar, onTrip, onFinish, onQuit, onEnd, onMap }: Props) {
  const [at, setAt] = useState<string | null>(null);          // item the shopper stands at (choice open)
  const [page, setPage] = useState<Page>("main");
  const [walking, setWalking] = useState<Goal | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [undo, setUndo] = useState<null | { key: string; name: string }>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [overview, setOverview] = useState(false);
  const [prefs, setPrefs] = useState<FeelPrefs>(feel.prefs);
  const [briefing, setBriefing] = useState(!trip.got.length && !trip.here && trip.items.length > 0);
  const [subName, setSubName] = useState("");
  const [nudge, setNudge] = useState<Nudge>(null);
  const nudged = useRef(new Set(trip.snapped));
  const nudgeTimer = useRef(0);
  const noThanks = useRef(0);   // two ✕ and the nudge stops for this trip
  const root = useRef<HTMLDivElement>(null);
  const juice = useRef<Juice | null>(null);
  const world = useRef<WorldApi | null>(null);
  const tripRef = useRef(trip); tripRef.current = trip;
  const timers = useRef<number[]>([]);
  const undoTimer = useRef(0);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  useEffect(() => {
    const j = new Juice(root.current!); juice.current = j;
    const r = () => j.resize(); addEventListener("resize", r);
    return () => { removeEventListener("resize", r); j.destroy(); timers.current.forEach(clearTimeout); };
  }, []);

  const L = trip.layout;
  const done = allHandled(trip);
  const item: QuestItem | null = at ? trip.items.find(i => i.key === at && !isHandled(trip, i.key)) ?? null : null;
  const section = item ? L.sections.find(s => s.id === item.section)! : null;
  const view_ = item ? sectionView(trip, item.section) : "real";
  const got = trip.got.length, total = trip.items.length;
  /* The next item: the one you picked, else the next on Arya's route. */
  const nextKey = (t: Trip) => {
    if (focus && !isHandled(t, focus)) return focus;
    const c = currentStop(t);
    return c ? leftIn(t, c)[0]?.key ?? null : null;
  };
  const next = nextKey(trip);
  const nextItem = next ? trip.items.find(i => i.key === next)! : null;

  const walkTo = useCallback((g: Goal) => {
    setAt(null); setPage("main");
    setNudge(n => (n && n.state !== "busy" ? null : n));
    if (g.kind === "item") setFocus(g.key);
    world.current?.walkTo(g);
    setOverview(false);
  }, []);

  const onArrive = useCallback((g: Goal) => {
    const t = tripRef.current;
    if (g.kind === "item") {
      const it = t.items.find(i => i.key === g.key);
      if (!it || isHandled(t, it.key)) return;
      onTrip(reduce(t, { type: "enter", section: it.section }));
      setAt(it.key); setPage("main"); setSubName("");
      tick(3);
    } else if (g.kind === "checkout") {
      if (allHandled(t)) { stinger(true); later(() => onFinish(tripRef.current), 450); }
      else {
        const n = t.items.filter(i => !isHandled(t, i.key)).length;
        setBanner({ title: `${n} item${n === 1 ? "" : "s"} still to decide`, sub: "Grab, substitute, skip or report them first", kind: "map" });
        later(() => setBanner(null), 1800);
      }
    }
  }, [onTrip, onFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Voice guide: says where you're headed. */
  useEffect(() => {
    if (!walking || walking.kind !== "item") return;
    const it = trip.items.find(i => i.key === walking.key); if (!it) return;
    const s = L.sections.find(x => x.id === it.section)!;
    say(sectionView(trip, s.id) === "fog" ? `Heading into the fog for ${it.name}.` : `Next, ${it.name}, in ${s.short}.`);
  }, [walking]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Plays what the reducer reports. In a real store the game stays
   * quiet (a tick and the points; eyes go back to the shelf) and the
   * big moments wait for checkout. Practice gets the full show. */
  const play = (events: GameEvent[], nxt: Trip) => {
    const j = juice.current!;
    const quiet = !nxt.practice;
    const P = (k: string) => world.current?.screenOf(k) ?? world.current?.screenOf("player") ?? { x: innerWidth / 2, y: innerHeight / 2 };
    let delay = 0;
    for (const e of events) {
      if (e.t === "grab") {
        const it = nxt.items.find(i => i.key === e.key)!, p = j.local(P(e.key));
        world.current?.pickup(e.key);
        j.splat(p.x, p.y, it.art, e.golden);
        j.float(p.x, p.y - 30, e.golden ? `+${e.pts} GOLDEN` : `+${e.pts}`, e.golden ? "gold" : "pts");
        if (e.chain > 1 && !e.golden && !events.some(x => x.t === "scout")) later(() => j.float(p.x + 46, p.y - 8, `x${e.chain} combo`, "chain"), 140);
        if (e.golden) { goldChime(); buzz([20, 40, 20, 40, 60]); } else { chime(e.chain); buzz(18); }
        later(() => j.pop(root.current?.querySelector(".qg-basket") ?? null), 600);
      } else if (e.t === "scout") {
        const p = j.local(P(e.key));
        later(() => { whoosh(); j.sparkle(p.x, p.y - 20, 22); j.float(p.x, p.y - 60, `+${e.pts} on the map!`, "scout"); }, 180);
        delay = Math.max(delay, 900);
        const s = nxt.layout.sections.find(x => x.id === e.section)!;
        void source.report({ kind: "found", store: nxt.layout.id, section: e.section, item: nxt.items.find(i => i.key === e.key)!.name });
        if (!quiet) {
          later(() => setBanner({ title: "Fog cleared!", sub: `${s.short} is on your map`, kind: "map" }), 300);
          later(() => setBanner(b => (b?.kind === "map" ? null : b)), 1700);
        }
      } else if (e.t === "report") {
        soft(); buzz(12);
        const it = nxt.items.find(i => i.key === e.key)!, p = j.local(P(e.key));
        j.float(p.x, p.y - 30, "Noted, thanks", "scout");
        void source.report({ kind: e.kind, store: nxt.layout.id, section: it.section, item: it.name });
      } else if (e.t === "clear") {
        const s = nxt.layout.sections.find(x => x.id === e.section)!, p = j.local(P("player"));
        if (quiet) { later(() => { tick(7); j.float(p.x, p.y - 60, `${e.sweep ? "Sweep! " : ""}${s.short} done +${e.pts}`, "chain"); }, delay + 300); continue; }
        later(() => {
          stinger(false); buzz([30, 50, 30]);
          setBanner({ title: e.sweep ? "CLEAN SWEEP!" : "SECTION CLEAR!", sub: `${s.short}  +${e.pts}`, kind: e.sweep ? "sweep" : "clear" });
          const c = j.at(root.current!.querySelector(".qg-banner")); j.burst(c.x, c.y, e.sweep ? 70 : 44);
        }, delay + 420);
        later(() => setBanner(null), delay + 1650);
      } else if (e.t === "allDone") {
        later(() => { const p = j.local(P("player")); j.float(p.x, p.y - 90, "List done! Checkout →", "chain"); }, delay + 900);
      } else if (e.t === "ungrab") soft();
    }
  };

  const act = (a: Action) => {
    const prev = tripRef.current, nxt = reduce(prev, a);
    if (nxt === prev) return;
    onTrip(nxt);
    play(nxt.events, nxt);
    if (!nxt.practice && (a.type === "grab" || a.type === "scout" || a.type === "ungrab")) {
      const it = nxt.items.find(i => i.key === a.key);
      if (it) source.progress?.({ kind: a.type === "ungrab" ? "ungrab" : "grab", item: it.name, instead: a.type === "grab" ? nxt.subs[a.key] : undefined });
    }
    if (a.type === "grab" || a.type === "scout") {
      const it = nxt.items.find(i => i.key === a.key)!;
      // Once per section, on a real trip whose host takes shelf photos.
      if (!nxt.practice && source.snap && !nxt.layout.mapped.includes(it.section) && !nudged.current.has(it.section) && noThanks.current < 2) {
        nudged.current.add(it.section);
        clearTimeout(nudgeTimer.current);
        setNudge({ section: it.section, item: it.name, state: "ask" });
        nudgeTimer.current = window.setTimeout(() => setNudge(n => (n?.state === "ask" ? null : n)), 8000);
      }
      setUndo({ key: a.key, name: it.name });
      clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(u => (u?.key === a.key ? null : u)), 5000);
    }
    if (a.type !== "ungrab") { setAt(null); setPage("main"); setFocus(null); }
  };

  const onTapItem = (key: string) => {
    const t = tripRef.current;
    if (isHandled(t, key)) { if (t.passed.includes(key)) onTrip(reduce(t, { type: "unpass", key })); else return; }
    walkTo({ kind: "item", key });
  };

  const snap = async (n: NonNullable<Nudge>, photo: File) => {
    if (!source.snap) return;
    clearTimeout(nudgeTimer.current);
    setNudge({ ...n, state: "busy" });
    const r = await source.snap({ section: n.section, item: n.item, photo });
    if (r.ok) {
      onTrip(reduce(tripRef.current, { type: "snapped", section: n.section }));
      chime(1); buzz(18);
      setNudge({ ...n, state: "done" });
      nudgeTimer.current = window.setTimeout(() => setNudge(x => (x?.state === "done" ? null : x)), 2500);
    } else setNudge({ ...n, state: "fail", note: r.note });
  };
  const nudgeSec = nudge ? L.sections.find(x => x.id === nudge.section)?.short ?? "this aisle" : "";

  const coach = trip.practice && !briefing && !sheet ? coachFor(trip, item ? "section" : "map", item, view_) : null;
  const left = trip.items.filter(i => !isHandled(trip, i.key) || trip.passed.includes(i.key));
  const cue = trip.practice ? "Practice" : L.kind === "simulated" ? "Typical layout" : L.kind === "partial" ? "Part mapped" : null;

  return (
    <div className={"qg-play qg-live " + (L.kind === "simulated" ? "is-sim" : "")} ref={root}>
      <div className="qg-worldwrap">
        <Suspense fallback={<div className="qg-loading">Opening the store…</div>}>
          <World3D trip={trip} avatar={avatar} focus={at ?? focus} onReady={api => { world.current = api; }} onArrive={onArrive} onWalking={setWalking} onTapItem={onTapItem} />
        </Suspense>
      </div>

      {/* HUD: back, where you are, the basket, help. */}
      <header className="qg-hud">
        <button className="qg-ic" onClick={() => setSheet("quit")} aria-label="Leave the quest">‹</button>
        <div className="qg-where">
          <b>{trip.practice && L.id === "practice" ? "Practice Market" : L.name}</b>
        </div>
        <button className="qg-basket" onClick={() => setSheet("list")} aria-label={`Cart: ${got} of ${total}. ${trip.points} points. Open the list`}>
          <img src={charArt("basket.webp")} alt="" />
          <span><b>{got}</b>/{total}</span>
          <i>{trip.points}</i>
        </button>
        <button className="qg-ic" onClick={() => setSheet("help")} aria-label="How to play and settings">?</button>
      </header>
      {/* The store's status: one quiet cue (usability audit: one pill, and
          "you can help map it" comes with the button). */}
      {cue && (
        <div className="qg-camrow">
          {onMap && !trip.practice
            ? <button className="qg-cue" onClick={() => setSheet("map")} aria-label={`${cue}. Map this store`}>{cue} · <b>Map it ›</b></button>
            : <span className="qg-cue">{cue}</span>}
        </div>
      )}
      {coach && (
        <motion.div key={coach.text} className="qg-coach" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <img src={charArt("compass.webp")} alt="" /><p>{coach.text}</p>
        </motion.div>
      )}
      {coach && !banner && <GhostHand target={coach.target} />}

      <AnimatePresence mode="wait" initial={false}>
        {item && section ? (
          <motion.section key={"shelf-" + item.key + page} className={"qg-shelf v-" + view_} initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={{ type: "spring", damping: 26, stiffness: 320 }}>
            <button className="qg-x qg-shelf-x" onClick={() => { setAt(null); setPage("main"); }} aria-label="Walk away without choosing">✕</button>
            <div className="qg-shelf-h">
              <div className="qg-shelf-art" style={{ backgroundImage: view_ === "fog" ? undefined : `url(${sceneArt(section)})` }}>
                <img className={trip.golden === item.key ? "golden" : ""} src={charArt(item.art)} alt="" />
              </div>
              <div>
                <span className={"qg-tag " + view_}>{view_ === "real" ? section.short : view_ === "fog" ? "Fog · not mapped yet" : `Simulated · ${section.short}`}</span>
                <h2>{trip.golden === item.key && <span className="qg-goldtag">★ ×2</span>}{item.name}</h2>
                <p className="qg-hint">{hintFor(item, view_, section.typical)}</p>
              </div>
            </div>
            {page === "main" && (
              <div className="qg-choices">
                {view_ === "fog"
                  ? <button className="qg-got scout" onClick={() => act({ type: "scout", key: item.key })}>Found it here <small>+{SCORE.item + SCORE.scout}</small></button>
                  : <button className={"qg-got" + (trip.golden === item.key ? " gold" : "")} onClick={() => act({ type: "grab", key: item.key })}>Grab it <small>+{SCORE.item * (trip.golden === item.key ? SCORE.golden : 1)}</small></button>}
                <div className="qg-choice-row">
                  <button className="qg-cant" onClick={() => setPage("nothere")}>Not here</button>
                  <button onClick={() => setPage("sub")}>Substitute</button>
                  <button onClick={() => act({ type: "pass", key: item.key })}>⏭ Skip</button>
                </div>
              </div>
            )}
            {page === "nothere" && (
              <div className="qg-opts">
                <button className="qg-opt" onClick={() => setPage("staff")}><b>Ask a staff member</b><span>Shows a card you can hand them.</span></button>
                <button className="qg-opt" onClick={() => act({ type: "report", key: item.key, kind: "empty" })}><b>The shelf is empty</b><span>Tells other shoppers. It counts as done; no points.</span></button>
                <button className="qg-opt" onClick={() => act({ type: "report", key: item.key, kind: "elsewhere" })}><b>↪ It's somewhere else here</b><span>Arya asks the next shopper to confirm.</span></button>
                <button className="qg-btn ghost" onClick={() => setPage("main")}>Back</button>
              </div>
            )}
            {page === "staff" && (
              <div className="qg-staff">
                <p>Excuse me, where can I find</p>
                <b>{item.name}?</b>
                <button className="qg-btn" onClick={() => setPage("main")}>Back to the shelf</button>
              </div>
            )}
            {page === "sub" && (
              <div className="qg-opts">
                <label className="qg-sub"><span>What are you taking instead? (optional)</span>
                  <input value={subName} onChange={e => setSubName(e.target.value)} placeholder={`Another ${item.name.toLowerCase()}`} />
                </label>
                <button className="qg-got" onClick={() => { act({ type: "grab", key: item.key, instead: subName.trim() || undefined }); setSubName(""); }}>Add substitute <small>+{SCORE.item}</small></button>
                <button className="qg-btn ghost" onClick={() => setPage("main")}>Back</button>
              </div>
            )}
          </motion.section>
        ) : (
          <motion.section key="dock" className="qg-dock" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}>
            <button className="qg-cam" onClick={() => { const o = !overview; setOverview(o); world.current?.setOverview(o); }} aria-label={overview ? "Follow my shopper" : "See the whole store"} aria-pressed={overview}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{overview ? <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></> : <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M3.5 10h17M10 10v10.5" /></>}</svg>
            </button>
            {nudge && (
              <div className={"qg-nudge " + nudge.state} role="status">
                <span className="qg-nudge-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg></span>
                <p>{nudge.state === "ask" ? <><b>{L.kind === "partial" ? "Spotted" : "Found"} in {nudgeSec}!</b> {L.kind === "partial" ? "Snap the shelf to clear the fog for good." : "Snap the shelf to put it on the map."}</>
                  : nudge.state === "busy" ? <>Reading the shelf… People are blurred first.</>
                  : nudge.state === "done" ? <><b>{nudgeSec} is on the map.</b> Thanks!</>
                  : <>{nudge.note || "That photo didn't go through."}</>}</p>
                {(nudge.state === "ask" || nudge.state === "fail") && <SnapButton className="qg-nudge-snap" onPhoto={f => void snap(nudge, f)}>{nudge.state === "fail" ? "Retry" : "Snap"}</SnapButton>}
                {nudge.state !== "busy" && <button className="qg-nudge-x" onClick={() => { clearTimeout(nudgeTimer.current); if (nudge.state === "ask") noThanks.current++; setNudge(null); }} aria-label="Not now">✕</button>}
              </div>
            )}
            {!total ? (
              <>
                <div className="qg-empty"><b>Your list is empty</b><small>Add what you need and Arya plans the walk.</small></div>
                <AddItem dispatch={a => onTrip(reduce(tripRef.current, a))} />
                <div className="qg-dock-row"><button onClick={onQuit}>Pick a saved list</button></div>
              </>
            ) : <>
            <div className="qg-items" role="list" aria-label="Your list">
              {left.map(i => (
                <button role="listitem" key={i.key} className={"qg-chip" + (i.key === next ? " on" : "") + (trip.passed.includes(i.key) ? " later" : "")} onClick={() => onTapItem(i.key)} aria-label={`Walk to ${i.name}`}>
                  <img src={charArt(i.art)} alt="" />{trip.golden === i.key && <i className="g">★</i>}
                </button>
              ))}
              {!left.length && <span className="qg-alldone">Everything on your list is decided ✓</span>}
            </div>
            {walking ? (
              <div className="qg-walking">{walking.kind === "checkout" ? "Heading to the checkout…" : `Zooming to ${trip.items.find(i => walking.kind === "item" && i.key === walking.key)?.name ?? "it"}…`}</div>
            ) : nextItem && !done ? (
              <button className="qg-go" onClick={() => walkTo({ kind: "item", key: nextItem.key })}>
                Next: {nextItem.name} <span className="qg-go-sub">{(() => { const s = L.sections.find(x => x.id === nextItem.section)!; return sectionView(trip, s.id) === "fog" ? "in the fog" : s.short; })()}</span>
              </button>
            ) : (
              <button className="qg-go fin" onClick={() => walkTo({ kind: "checkout" })}>Head to checkout</button>
            )}
            <div className="qg-dock-row">
              {undo && <button className="undo" onClick={() => { act({ type: "ungrab", key: undo.key }); setUndo(null); }}>↶ Undo {undo.name}</button>}
              <button onClick={() => setSheet("list")}>List{left.length ? ` · ${left.length} left` : ""}</button>
              {!done && <button onClick={() => walkTo({ kind: "checkout" })}>Checkout</button>}
            </div>
            </>}
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {banner && (
          <motion.div className={"qg-banner " + banner.kind} role="status" initial={{ scale: 0.4, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: -3 }} exit={{ scale: 1.2, opacity: 0 }} transition={{ type: "spring", damping: 12, stiffness: 260 }}>
            <b>{banner.title}</b>{banner.sub && <span>{banner.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {briefing && <Mission trip={trip} onStart={() => { setBriefing(false); stinger(false); const k = nextKey(tripRef.current); if (k) later(() => walkTo({ kind: "item", key: k }), 350); }} />}
      </AnimatePresence>

      {/* ---- sheets ---- */}
      <Sheet open={sheet === "list"} onClose={() => setSheet(null)} title={`Your list · ${got} of ${total}`} tall>
        <ListSheet trip={trip} dispatch={a => onTrip(reduce(tripRef.current, a))} onGo={id => { setSheet(null); const k = leftIn(tripRef.current, id)[0]?.key; if (k) walkTo({ kind: "item", key: k }); }} />
      </Sheet>
      <Sheet open={sheet === "map"} onClose={() => setSheet(null)} title="Map this store?">
        <p className="qg-p">Arya is guessing this layout. Pan your camera along the aisles and it maps them for every shopper. People are blurred first.</p>
        <p className="qg-p">{got ? `You have ${got} of ${total} in the cart. Your grabs are saved; the trip ends here.` : "Nothing is in the cart yet, so nothing is lost."}</p>
        <div className="qg-opts">
          <button id="qg-mapnow" className="qg-btn primary" onClick={() => { setSheet(null); onMap?.(); }}>Map it now</button>
          <button className="qg-btn" onClick={() => setSheet(null)}>After this trip</button>
          <button className="qg-btn ghost" onClick={() => setSheet(null)}>Keep playing</button>
        </div>
      </Sheet>
      <Sheet open={sheet === "help"} onClose={() => setSheet(null)} title="How to play" tall>
        <HowTo />
        <div className="qg-toggles">
          {([["sound", "Sounds"], ["buzz", "Buzz (Android)"], ["voice", "Voice guide: Arya says the next stop, so the phone can stay in the cart"]] as const).map(([k, label]) => (
            <label key={k} className="qg-toggle"><span>{label}</span>
              <input type="checkbox" checked={prefs[k]} onChange={e => { feel.set({ [k]: e.target.checked }); setPrefs(feel.prefs); }} />
            </label>
          ))}
        </div>
      </Sheet>
      <Sheet open={sheet === "quit"} onClose={() => setSheet(null)} title="Leave this quest?">
        <p className="qg-p">{trip.practice ? "Practice never saves, so nothing is lost." : !got ? "Nothing is in the cart yet, so this trip is not saved." : `You have ${got} of ${total} in the cart. Finish now to keep your points, or keep going.`}</p>
        <div className="qg-opts">
          <button className="qg-btn primary" onClick={() => setSheet(null)}>Keep playing</button>
          {!trip.practice && got > 0 && <button className="qg-btn" onClick={() => onFinish(trip)}>Finish with what I have</button>}
          {!trip.practice && onEnd && got > 0
            ? <>
                <button id="qg-endquest" className="qg-btn" onClick={onEnd}>End quest</button>
                <button className="qg-btn ghost" onClick={onQuit}>Keep it for later</button>
                <p className="qg-small">End quest closes this trip. Anything you grabbed stays checked off on your list.</p>
              </>
            : <button className="qg-btn ghost" onClick={!trip.practice && onEnd ? onEnd : onQuit}>Leave</button>}
        </div>
      </Sheet>
    </div>
  );
}

function hintFor(item: QuestItem, view: string, typical: string) {
  if (view === "fog") return "Nobody has mapped this part yet. Look around: if you find it, you put it on the map.";
  if (item.spot) return item.spot.hint;
  if (view === "guess") return `${typical}. A guess, not a pin.`;
  return "Arya has not pinned the exact shelf yet.";
}

/* One list (usability audit: Route and List were two sheets for one
 * thing). Add at the top, then the items by section in walking order.
 * Arya keeps the order; moving or skipping a section is one link down. */
function ListSheet({ trip, dispatch, onGo }: { trip: Trip; dispatch: (a: Action) => void; onGo: (id: string) => void }) {
  const [edit, setEdit] = useState(false);
  const order = stops(trip);
  const live = order.filter(id => !trip.skipped.includes(id));
  return (
    <div className="qg-list">
      <AddItem dispatch={dispatch} />
      {edit ? <RouteEdit trip={trip} dispatch={dispatch} onDone={() => setEdit(false)} /> : <>
        {order.length ? <p className="qg-p">In walking order. Arya sorts it; tap a section to go there.</p> : <p className="qg-p">Nothing on your list yet.</p>}
        {order.map(id => {
          const s = trip.layout.sections.find(x => x.id === id)!, sk = trip.skipped.includes(id);
          return (
            <div key={id} className="qg-list-sec">
              <button className="qg-list-h" onClick={() => onGo(id)}>{sk ? s.short : `${live.indexOf(id) + 1} · ${s.short}`}{sk && <em> · skipped</em>}<span>Go →</span></button>
              {itemsIn(trip, id).map(i => {
                const g = trip.got.includes(i.key), r = trip.reports.find(x => x.key === i.key), p = trip.passed.includes(i.key);
                return (
                  <div key={i.key} className={"qg-list-i" + (g ? " got" : "")}>
                    <img src={charArt(i.art)} alt="" /><span>{i.name}</span>
                    <small>{g ? "✓ got it" : r ? (r.kind === "empty" ? "shelf empty" : "somewhere else") : p ? "later" : ""}</small>
                  </div>
                );
              })}
            </div>
          );
        })}
        {order.length > 1 && <button className="qg-link qg-list-edit" onClick={() => setEdit(true)}>Change the order or skip a section</button>}
      </>}
    </div>
  );
}

function AddItem({ dispatch }: { dispatch: (a: Action) => void }) {
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim(); if (!n) return;
    const item: QuestItem = { key: `add-${Date.now()}`, name: n[0].toUpperCase() + n.slice(1), art: artFor(n), section: sectionFor(n) };
    dispatch({ type: "addItem", item }); setName("");
  };
  return (
    <div className="qg-add">
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add an item, e.g. peanut butter" aria-label="Add an item" />
      <button onClick={add} disabled={!name.trim()}>Add</button>
    </div>
  );
}

/* Moving or skipping a stop, before or during a trip. Arya's order is one tap away. */
function RouteEdit({ trip, dispatch, onDone }: { trip: Trip; dispatch: (a: Action) => void; onDone: () => void }) {
  const all = stops(trip);
  const live = useMemo(() => all.filter(id => !trip.skipped.includes(id)), [all, trip.skipped]);
  const cur = currentStop(trip);
  return (
    <div className="qg-route">
      <p className="qg-p">{routeNote(live)}</p>
      <ol>
        {all.map((id, i) => {
          const s = trip.layout.sections.find(x => x.id === id)!, sk = trip.skipped.includes(id), left = leftIn(trip, id).length;
          return (
            <li key={id} className={(sk ? "sk " : "") + (id === cur ? "cur " : "") + (!left ? "done" : "")}>
              <span className="n">{left ? (sk ? "–" : live.indexOf(id) + 1) : "✓"}</span>
              <span className="t"><b>{s.short}</b><small>{itemsIn(trip, id).length} item{itemsIn(trip, id).length === 1 ? "" : "s"}{sectionView(trip, id) === "fog" ? " · fog" : ""}</small></span>
              <button aria-label={`Move ${s.short} up`} disabled={i === 0} onClick={() => dispatch({ type: "move", section: id, by: -1 })}>↑</button>
              <button aria-label={`Move ${s.short} down`} disabled={i === all.length - 1} onClick={() => dispatch({ type: "move", section: id, by: 1 })}>↓</button>
              <button className="sk" onClick={() => dispatch({ type: sk ? "unskipSection" : "skipSection", section: id })}>{sk ? "Add back" : "Skip"}</button>
            </li>
          );
        })}
      </ol>
      <div className="qg-opts">
        <button className="qg-btn primary" onClick={onDone}>Done</button>
        <button className="qg-btn ghost" onClick={() => dispatch({ type: "resetOrder" })}>Use Arya's order</button>
      </div>
    </div>
  );
}

export function HowTo() {
  const steps: [string, string, string][] = [
    ["compass.webp", "Follow the dots", "Your list becomes the shortest walk through the store. Tap Next, or any item card, and your shopper walks there."],
    ["basket.webp", "Look first, then choose", "At the shelf, pick Grab it, Not here, Substitute or Skip. Only a grab earns points; skipping never costs anything."],
    ["binoculars.webp", "Clear the fog", "Grey cloudy sections are not mapped yet. Find something there and tap Found it: you just mapped it for everyone."],
    ["egg.webp", "Golden item", "One item each trip is golden and worth double. Nothing to lose, no timer, no lives."],
  ];
  return (
    <div className="qg-howto">
      {steps.map(([a, t, d], i) => (
        <div key={t} className="qg-how"><img src={charArt(a)} alt="" /><div><b>{i + 1}. {t}</b><p>{d}</p></div></div>
      ))}
    </div>
  );
}

/* The mission card (GTA's mission intro): what this trip is, in three
 * numbers, and today's golden item. One tap to start. */
function Mission({ trip, onStart }: { trip: Trip; onStart: () => void }) {
  const g = trip.items.find(i => i.key === trip.golden);
  const fog = liveStops(trip).filter(id => sectionView(trip, id) === "fog").length;
  return (
    <motion.div className="qg-mission" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="qg-mission-c" initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: "spring", damping: 14, stiffness: 220 }}>
        <p className="qg-kicker">{trip.practice ? "Practice quest" : `${trip.layout.name} · ${trip.layout.area}`}</p>
        <h2>{trip.practice ? "Learn the moves" : "Today's quest"}</h2>
        <div className="qg-mission-stats">
          <div><b>{trip.items.length}</b><small>items</small></div>
          <div><b>{liveStops(trip).length}</b><small>stops</small></div>
          <div><b>{fog}</b><small>in fog</small></div>
        </div>
        {g && (
          <div className="qg-mission-gold">
            <img src={charArt(g.art)} alt="" />
            <span><b>★ Golden: {g.name}</b>Worth double today.</span>
          </div>
        )}
        <p className="qg-p" style={{ marginTop: 12 }}>No timer and nothing to lose. Shop at your own pace.</p>
        <button className="qg-btn primary big" onClick={onStart}>Let's go</button>
      </motion.div>
    </motion.div>
  );
}
