/* A trip in progress: the store map (overworld) and a section (level).
 * The reducer owns the rules; this screen dispatches actions and plays
 * the events they emit as juice, sound, buzz and voice. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { routeNote } from "../core/route";
import { artFor, type QuestSource } from "../core/source";
import { sectionFor } from "../core/template";
import {
  SCORE, allHandled, currentStop, isHandled, itemsIn, leftIn, liveStops, nextItem, reduce, sectionView, stops,
  type Action, type GameEvent, type Trip,
} from "../core/trip";
import type { QuestItem } from "../core/types";
import { buzz, chime, feel, goldChime, say, soft, stinger, tick, whoosh, type FeelPrefs } from "../fx/feel";
import { Juice } from "../fx/juice";
import { charArt, img } from "../assets";
import { GhostHand, KindBadge, MiniMap, Sheet } from "./bits";
import { StoreMap, type MapHandle } from "./StoreMap";
import { coachFor } from "./coach";
import { AisleScene } from "./AisleScene";

type Props = { trip: Trip; source: QuestSource; onTrip: (t: Trip) => void; onFinish: (t: Trip) => void; onQuit: () => void };
type SheetName = null | "list" | "route" | "cant" | "help" | "quit";
type Banner = null | { title: string; sub?: string; kind: "clear" | "sweep" | "map" };

export function Play({ trip, source, onTrip, onFinish, onQuit }: Props) {
  const [view, setView] = useState<"map" | "section">("map");
  const [sec, setSec] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [undo, setUndo] = useState<null | { key: string; name: string }>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [findIt, setFindIt] = useState(0);
  const [prefs, setPrefs] = useState<FeelPrefs>(feel.prefs);
  const [briefing, setBriefing] = useState(!trip.got.length && !trip.here);
  const root = useRef<HTMLDivElement>(null);
  const juice = useRef<Juice | null>(null);
  const map = useRef<MapHandle>(null);
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
  const cur = currentStop(trip);
  const done = allHandled(trip);
  const section = sec ? L.sections.find(s => s.id === sec) || null : null;
  const secItems = sec ? itemsIn(trip, sec) : [];
  const item: QuestItem | null = (focus && secItems.find(i => i.key === focus && !isHandled(trip, i.key))) || (sec ? nextItem(trip, sec) : null);
  const view_ = sec ? sectionView(trip, sec) : "real";
  const got = trip.got.length, total = trip.items.length;

  /* Voice guide: the next stop, out loud, when it changes. */
  const spoke = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "map") return;
    const key = cur || (done ? "checkout" : "");
    if (spoke.current === key) return;
    spoke.current = key;
    if (cur) { const s = L.sections.find(x => x.id === cur)!; say(`Next stop, ${s.short}. ${leftIn(trip, cur).map(i => i.name).join(", ")}.`); }
    else if (done) say("That's everything. Head to the checkout.");
  }, [view, cur, done, L.sections, trip]);

  const goSection = useCallback((id: string) => {
    if (!itemsIn(tripRef.current, id).length) { setBanner({ title: "Nothing on your list here", kind: "map" }); later(() => setBanner(null), 1100); return; }
    onTrip(reduce(tripRef.current, { type: "enter", section: id }));
    setSec(id); setFocus(null); setView("section"); setSheet(null);
  }, [onTrip]); // eslint-disable-line react-hooks/exhaustive-deps

  const backToMap = () => { setView("map"); setFocus(null); };

  /* Plays what the reducer reports. In a real store the game stays
   * quiet (a tick and the points; eyes go back to the shelf) and the
   * big moments wait for checkout. Practice gets the full show. */
  const play = (events: GameEvent[], next: Trip, from: { x: number; y: number }) => {
    const j = juice.current!;
    const quiet = !next.practice;
    const basket = root.current?.querySelector(".qg-basket") || null;
    let delay = 0;
    for (const e of events) {
      if (e.t === "grab") {
        const it = next.items.find(i => i.key === e.key)!;
        j.splat(from.x, from.y, it.art, e.golden);
        j.float(from.x, from.y - 30, e.golden ? `+${e.pts} GOLDEN` : `+${e.pts}`, e.golden ? "gold" : "pts");
        if (e.chain > 1 && !e.golden && !events.some(x => x.t === "scout")) later(() => j.float(from.x + 46, from.y - 8, `x${e.chain} combo`, "chain"), 140);
        j.fly(from, basket, charArt(it.art));
        if (e.golden) { goldChime(); buzz([20, 40, 20, 40, 60]); } else { chime(e.chain); buzz(18); }
      } else if (e.t === "scout") {
        later(() => { whoosh(); j.sparkle(from.x, from.y - 60, 22); j.float(from.x, from.y - 90, `+${e.pts} on the map!`, "scout"); }, 180);
        delay = Math.max(delay, 900);
        const s = next.layout.sections.find(x => x.id === e.section)!;
        void source.report({ kind: "found", store: next.layout.id, section: e.section, item: next.items.find(i => i.key === e.key)!.name });
        if (!quiet) {
          later(() => { setBanner({ title: "Fog cleared!", sub: `${s.short} is on your map`, kind: "map" }); }, 300);
          later(() => setBanner(b => (b?.kind === "map" ? null : b)), 1700);
        }
      } else if (e.t === "report") {
        soft(); buzz(12);
        j.float(from.x, from.y - 30, `+${e.pts} thanks!`, "scout");
        const it = next.items.find(i => i.key === e.key)!;
        void source.report({ kind: e.kind, store: next.layout.id, section: it.section, item: it.name });
      } else if (e.t === "clear") {
        const s = next.layout.sections.find(x => x.id === e.section)!;
        if (quiet) {
          later(() => { tick(7); j.float(from.x, from.y - 70, `${e.sweep ? "Sweep! " : ""}${s.short} done +${e.pts}`, "chain"); }, delay + 300);
          later(() => { setView("map"); setFocus(null); }, delay + 1100);
          continue;
        }
        later(() => {
          stinger(false); buzz([30, 50, 30]);
          setBanner({ title: e.sweep ? "CLEAN SWEEP!" : "SECTION CLEAR!", sub: `${s.short}  +${e.pts}`, kind: e.sweep ? "sweep" : "clear" });
          const c = j.at(root.current!.querySelector(".qg-banner"));
          j.burst(c.x, c.y, e.sweep ? 70 : 44);
        }, delay + 420);
        later(() => { setBanner(null); setView("map"); setFocus(null); }, delay + 1650);
      } else if (e.t === "ungrab") soft();
    }
  };

  const act = (a: Action, fromEl?: Element | null) => {
    const prev = tripRef.current, next = reduce(prev, a);
    if (next === prev) return;
    const j = juice.current;
    const from = j ? j.at(fromEl || root.current!.querySelector(".qg-art"), 0.45) : { x: 0, y: 0 };
    onTrip(next);
    play(next.events, next, from);
    if (a.type === "grab") {
      const it = next.items.find(i => i.key === a.key)!;
      setUndo({ key: a.key, name: it.name });
      clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(u => (u?.key === a.key ? null : u)), 4000);
    }
    setFocus(null);
    // A section with nothing left and no clear (all passed or reported): back to the map.
    if (sec && !leftIn(next, sec).length && !next.events.some(e => e.t === "clear")) later(backToMap, 700);
  };

  const coach = trip.practice && !briefing ? coachFor(trip, view, item, view_) : null;

  return (
    <div className={"qg-play " + (L.kind === "simulated" ? "is-sim" : "")} ref={root}>
      {/* HUD: back, where you are, the basket, help. */}
      <header className="qg-hud">
        <button className="qg-ic" onClick={() => (view === "section" ? backToMap() : setSheet("quit"))} aria-label={view === "section" ? "Back to the map" : "Leave the quest"}>‹</button>
        <div className="qg-where">
          <b>{trip.practice ? "Practice Market" : L.name}</b>
          <KindBadge kind={L.kind} practice={trip.practice} />
        </div>
        <button className="qg-basket" onClick={() => setSheet("list")} aria-label={`Basket: ${got} of ${total}. ${trip.points} points. Open the list`}>
          <img src={charArt("basket.webp")} alt="" />
          <span><b>{got}</b>/{total}</span>
          <i>{trip.points}</i>
        </button>
        <button className="qg-ic" onClick={() => setSheet("help")} aria-label="How to play and settings">?</button>
      </header>
      {coach && (
        <motion.div key={coach.text} className="qg-coach" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <img src={charArt("compass.webp")} alt="" /><p>{coach.text}</p>
        </motion.div>
      )}
      {coach && !sheet && !banner && <GhostHand target={coach.target} />}

      <div className="qg-stagewrap">
          <motion.section className={"qg-mapview" + (view === "map" ? "" : " off")} aria-hidden={view !== "map"} initial={false} animate={view === "map" ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.06 }} transition={{ duration: 0.24 }}>
            {L.kind === "simulated" && <p className="qg-note sim">Simulated store: a typical layout. Sections are guesses until shoppers map it.</p>}
            <div className="qg-mapwrap">
              <StoreMap ref={map} trip={trip} active={view === "map"} tokenSrc={charArt("basket.webp")} onSection={goSection}
                onWalkStep={p => { const j = juice.current; if (j) { const q = j.local(p); j.dust(q.x, q.y + 4); } }}
                onReveal={p => { const j = juice.current; if (j) { const q = j.local(p); j.sparkle(q.x, q.y, 18); } }} />
              {L.kind === "partial" && <span className="qg-legend"><i className="fog" /> Fog: not mapped yet. Find things there to map it.</span>}
            </div>
            <Dock trip={trip} cur={cur} done={done} onGo={() => (cur ? goSection(cur) : onFinish(trip))} onRoute={() => setSheet("route")} onList={() => setSheet("list")} onRetry={k => { const it = trip.items.find(i => i.key === k)!; onTrip(reduce(tripRef.current, { type: "unpass", key: k })); later(() => goSection(it.section), 0); }} undo={undo} onUndo={() => { if (undo) act({ type: "ungrab", key: undo.key }); setUndo(null); }} />
          </motion.section>
        <AnimatePresence initial={false}>
        {view === "section" && section && (
          <motion.section key={"s-" + section.id} className={"qg-secview v-" + view_} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ type: "spring", damping: 24, stiffness: 300 }}>
            <div className="qg-scene" style={{ ["--tint" as string]: "#" + section.color.toString(16).padStart(6, "0") }}>
              <AisleScene kind={section.kind} seed={section.id} name={section.short} tint={section.color} look={view_} art={img(`quest/${section.id}.webp`)} />
              <div className="qg-scene-h">
                <h2>{section.name}</h2>
                <span className={"qg-tag " + view_}>{view_ === "real" ? "Mapped" : view_ === "fog" ? "Fog" : "Simulated"}</span>
              </div>
              <MiniMap trip={trip} here={section.id} onClick={backToMap} />
              {item ? (
                <ItemStage key={item.key} item={item} view={view_} golden={trip.golden === item.key} typical={section.typical} pulse={findIt} />
              ) : (
                <div className="qg-empty">All done here</div>
              )}
              {view_ === "fog" && <FogLayer />}
            </div>

            {item && (
              <div className="qg-act">
                <p className="qg-itemname">{trip.golden === item.key && <span className="qg-goldtag">★ Golden ×2</span>}{item.name}</p>
                <p className="qg-hint">{hintFor(item, view_, section.typical)}</p>
                {view_ === "fog" ? (
                  <button className="qg-got scout" onClick={() => act({ type: "scout", key: item.key })}>Found it! <small>+{SCORE.item + SCORE.scout}</small></button>
                ) : (
                  <button className={"qg-got" + (trip.golden === item.key ? " gold" : "")} onClick={() => act({ type: "grab", key: item.key })}>Got it <small>+{SCORE.item * (trip.golden === item.key ? SCORE.golden : 1)}</small></button>
                )}
                <button className="qg-cant" onClick={() => setSheet("cant")}>Can't find it?</button>
              </div>
            )}
            <div className="qg-rail" role="list" aria-label={`${section.short} items`}>
              {secItems.map(i => {
                const h = isHandled(trip, i.key), g = trip.got.includes(i.key);
                return (
                  <button role="listitem" key={i.key} className={"qg-chip" + (item?.key === i.key ? " on" : "") + (h ? " done" : "")} onClick={() => !h && setFocus(i.key)} disabled={h} aria-label={`${i.name}${g ? ", got it" : h ? ", reported" : ""}`}>
                    <img src={charArt(i.art)} alt="" />{g && <i>✓</i>}{h && !g && <i className="r">!</i>}
                  </button>
                );
              })}
            </div>
          </motion.section>
        )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {banner && (
          <motion.div className={"qg-banner " + banner.kind} role="status" initial={{ scale: 0.4, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: -3 }} exit={{ scale: 1.2, opacity: 0 }} transition={{ type: "spring", damping: 12, stiffness: 260 }}>
            <b>{banner.title}</b>{banner.sub && <span>{banner.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {undo && view === "section" && (
          <motion.div className="qg-snack" role="status" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
            <span>Got {undo.name}</span>
            <button onClick={() => { act({ type: "ungrab", key: undo.key }); setUndo(null); }}>Undo</button>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {briefing && <Mission trip={trip} onStart={() => { setBriefing(false); stinger(false); }} />}
      </AnimatePresence>

      {/* ---- sheets ---- */}
      <Sheet open={sheet === "list"} onClose={() => setSheet(null)} title={`Your list · ${got} of ${total}`} tall>
        <ListSheet trip={trip} onGo={goSection} />
      </Sheet>
      <Sheet open={sheet === "route"} onClose={() => setSheet(null)} title="Your route" tall>
        <RouteSheet trip={trip} dispatch={a => onTrip(reduce(tripRef.current, a))} />
      </Sheet>
      <Sheet open={sheet === "cant"} onClose={() => setSheet(null)} title={item ? `Can't find ${item.name}?` : "Can't find it?"}>
        {item && section && (
          <div className="qg-opts">
            <button className="qg-opt" onClick={() => { setSheet(null); setFindIt(n => n + 1); say(hintFor(item, view_, section.typical)); }}>
              <b>🔎 Find it for me</b><span>{item.spot ? `Arya shows the shelf: ${item.spot.hint}.` : view_ === "real" ? "Arya has not pinned this shelf yet. Staff can point you to it." : `A guess: ${section.typical.toLowerCase()}. Staff can point you to it.`}</span>
            </button>
            <button className="qg-opt" onClick={() => { setSheet(null); act({ type: "grab", key: item.key }); }}>
              <b>🔁 I got a substitute</b><span>Another brand or size counts. +{SCORE.item}</span>
            </button>
            <button className="qg-opt" onClick={() => { setSheet(null); act({ type: "report", key: item.key, kind: "empty" }); }}>
              <b>🫙 The shelf is empty</b><span>Tell other shoppers. +{SCORE.report}</span>
            </button>
            <button className="qg-opt" onClick={() => { setSheet(null); act({ type: "report", key: item.key, kind: "elsewhere" }); }}>
              <b>↪ It's somewhere else here</b><span>Arya will ask the next shopper to confirm. +{SCORE.report}</span>
            </button>
            <button className="qg-opt" onClick={() => { setSheet(null); act({ type: "pass", key: item.key }); }}>
              <b>⏭ Skip for now</b><span>It stays on your list.</span>
            </button>
          </div>
        )}
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
        <p className="qg-p">{trip.practice ? "Practice never saves, so nothing is lost." : `You have ${got} of ${total} in the basket. Finish now to keep your points, or keep going.`}</p>
        <div className="qg-opts">
          <button className="qg-btn primary" onClick={() => setSheet(null)}>Keep playing</button>
          {!trip.practice && got > 0 && <button className="qg-btn" onClick={() => onFinish(trip)}>Finish with what I have</button>}
          <button className="qg-btn ghost" onClick={onQuit}>Leave</button>
        </div>
      </Sheet>
    </div>
  );
}

function hintFor(item: QuestItem, view: string, typical: string) {
  if (view === "fog") return "Nobody has mapped this aisle. Look around: when you find it, you put it on the map.";
  if (item.spot) return item.spot.hint;
  if (view === "guess") return `${typical}. A guess, not a pin.`;
  return "Arya has not pinned the shelf yet.";
}

/* The item in its scene. A mapped spot gets a glowing ring at the
 * shelf; a guess never gets a ring (we do not point at a shelf we have
 * not seen). */
function ItemStage({ item, view, golden, typical, pulse }: { item: QuestItem; view: string; golden: boolean; typical: string; pulse: number }) {
  const spot = view === "real" && item.spot?.shelf;
  return (
    <div className="qg-stage">
      {spot && <span key={pulse} className={"qg-target" + (pulse ? " find" : "")} style={{ left: spot[0] + "%", top: spot[1] + "%" }} aria-hidden="true" />}
      <motion.img className={"qg-art" + (golden ? " golden" : "")} src={charArt(item.art)} alt={item.name}
        initial={{ scale: 0.3, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: "spring", damping: 11, stiffness: 220 }} />
      {view === "guess" && <span className="qg-guess">Simulated · {typical.toLowerCase()}</span>}
    </div>
  );
}

function FogLayer() {
  return (
    <div className="qg-fog" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 90}%`, top: `${10 + ((i * 23) % 70)}%`, animationDelay: `${-i * 1.3}s` }} />)}
    </div>
  );
}

function Dock({ trip, cur, done, onGo, onRoute, onList, onRetry, undo, onUndo }: { trip: Trip; cur: string | null; done: boolean; onGo: () => void; onRoute: () => void; onList: () => void; onRetry: (key: string) => void; undo: { name: string } | null; onUndo: () => void }) {
  const live = liveStops(trip);
  const s = cur ? trip.layout.sections.find(x => x.id === cur)! : null;
  const left = cur ? leftIn(trip, cur) : [];
  const fog = cur ? sectionView(trip, cur) === "fog" : false;
  const passed = trip.passed.length, skipped = trip.skipped.length;
  return (
    <div className="qg-dock">
      {s ? (
        <>
          <div className="qg-next">
            <span className="qg-step">Stop {live.indexOf(cur!) + 1} of {live.length}</span>
            <b>{s.short}{fog && <em> · fog</em>}</b>
            <div className="qg-faces">{left.slice(0, 5).map(i => <img key={i.key} src={charArt(i.art)} alt={i.name} title={i.name} />)}{left.length > 5 && <span>+{left.length - 5}</span>}</div>
          </div>
          <button className="qg-go" onClick={onGo}>Go to {s.short} <span aria-hidden="true">→</span></button>
        </>
      ) : (
        <>
          <div className="qg-next">
            <span className="qg-step">{done ? "Everything is handled" : `${passed + skipped ? "Some items are set aside" : "All stops done"}`}</span>
            <b>Head to the checkout</b>
          </div>
          {passed > 0 && (() => { const first = trip.items.find(i => trip.passed.includes(i.key))!; return (
            <p className="qg-aside">Set aside: {trip.items.filter(i => trip.passed.includes(i.key)).map(i => i.name).join(", ")}. <button className="qg-link" onClick={() => onRetry(first.key)}>Look for {first.name} again</button></p>
          ); })()}
          <button className="qg-go fin" onClick={onGo}>Finish trip <span aria-hidden="true">🏁</span></button>
        </>
      )}
      <div className="qg-dock-row">
        {undo && <button className="undo" onClick={onUndo}>↶ Undo {undo.name}</button>}
        <button onClick={onRoute}>🗺️ Route</button>
        <button onClick={onList}>📝 List</button>
      </div>
    </div>
  );
}

function ListSheet({ trip, onGo }: { trip: Trip; onGo: (id: string) => void }) {
  const order = stops(trip);
  return (
    <div className="qg-list">
      {order.map(id => {
        const s = trip.layout.sections.find(x => x.id === id)!;
        return (
          <div key={id} className="qg-list-sec">
            <button className="qg-list-h" onClick={() => onGo(id)}>{s.short}{trip.skipped.includes(id) && <em> · skipped</em>}<span>Go →</span></button>
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
    </div>
  );
}

/* Route editing before or during a trip: move a stop, skip it, add an
 * item. Arya's order is one tap away. */
function RouteSheet({ trip, dispatch }: { trip: Trip; dispatch: (a: Action) => void }) {
  const [name, setName] = useState("");
  const all = stops(trip);
  const cur = currentStop(trip);
  const add = () => {
    const n = name.trim(); if (!n) return;
    const item: QuestItem = { key: `add-${Date.now()}`, name: n[0].toUpperCase() + n.slice(1), art: artFor(n), section: sectionFor(n) };
    dispatch({ type: "addItem", item }); setName("");
  };
  const live = useMemo(() => all.filter(id => !trip.skipped.includes(id)), [all, trip.skipped]);
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
      <div className="qg-add">
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Add an item, e.g. peanut butter" aria-label="Add an item" />
        <button onClick={add} disabled={!name.trim()}>Add</button>
      </div>
      <button className="qg-btn ghost" onClick={() => dispatch({ type: "resetOrder" })}>Use Arya's order</button>
    </div>
  );
}

export function HowTo() {
  const steps: [string, string, string][] = [
    ["compass.webp", "Follow the dots", "Your list becomes a route through the store. Tap Go to walk to the next stop."],
    ["basket.webp", "Grab and tap", "Put the item in your cart, then tap Got it. Grab a whole section in one visit for a clean sweep."],
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

/* Painted scene art for a section, when the app has it (generated
 * once, see tools/gen_quest_scenes.py). Without it the drawn aisle
 * underneath shows through. */
