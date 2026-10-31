/* Build: be the store manager. Never a blank slate: Arya asks three
 * fun questions (what kind of store, how it looks, what should be big),
 * builds the whole store, and you walk it, change it by saying what to
 * move, and keep it: as My map for a real store you shop at, or as a
 * dream store that is only ever played as practice. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import type { QuestSource, SavedMap } from "../core/source";
import type { StoreSummary } from "../core/types";
import { buildLayout } from "../core/template";
import { newTrip } from "../core/trip";
import type { StoreGraph } from "../map/graph";
import { FOCUS, LOOKS, fromAnswers, type Answers, type Focus, type Look } from "../map/answers";
import { PRESETS, type StoreType } from "../map/presets";
import type { WorldApi } from "../world/World3D";

const World3D = lazy(() => import("../world/World3D").then(m => ({ default: m.World3D })));

type Target = { kind: "store"; store: StoreSummary } | { kind: "dream"; name: string };
type Step =
  | { s: "home" } | { s: "which" } | { s: "dreamname" }
  | { s: "type" } | { s: "look" } | { s: "focus" }
  | { s: "making" } | { s: "made"; graph: StoreGraph; saved?: SavedMap };

const TYPES: { id: Answers["type"]; name: string; blurb: string }[] = [
  ...(Object.entries(PRESETS) as [StoreType, (typeof PRESETS)[StoreType]][]).map(([id, p]) => ({ id, name: p.name, blurb: p.blurb })),
  { id: "cuisine", name: "A cuisine", blurb: "Turkish, Mexican, Korean… you say" },
  { id: "single", name: "One kind of food", blurb: "A cheese shop, a bakery, a fruit stand" },
];

/* A store's type guessed from its name, so a real store starts close. */
export function guessType(name: string): StoreType {
  const n = name.toLowerCase();
  if (/costco|sam'?s club|bj'?s|warehouse/.test(n)) return "warehouse";
  if (/whole foods|sprouts|natural|co-?op|health/.test(n)) return "health";
  if (/patel|india|desi|apna|bazaar/.test(n)) return "indian";
  if (/7-?eleven|corner|mart|market$|deli/.test(n)) return "corner";
  return "supermarket";
}

/* findStore: the app's own store search (owner 2026-10-29: find and
 * add a store right here, not only in Lists). It calls onAdded once a
 * store joins My stores. */
export function Build({ source, onBack, onWalk, findStore }: { source: QuestSource; onBack: () => void; onWalk: (graph: StoreGraph, name: string) => void;
  findStore?: (onAdded: () => void) => ReactNode }) {
  const [step, setStep] = useState<Step>({ s: "home" });
  const [target, setTarget] = useState<Target | null>(null);
  const [a, setA] = useState<Answers>({ type: "supermarket", look: "market", focus: [] });
  const [saved, setSaved] = useState<SavedMap[]>([]);
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const loadStores = () => void source.nearbyStores().then(setStores).catch(() => setStores([]));
  useEffect(() => { void source.maps?.().then(setSaved).catch(() => {}); }, [source]);
  useEffect(() => { if (step.s === "which") loadStores(); }, [step.s, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = target?.kind === "store" ? target.store.name : target?.name || "My store";
  const make = async () => {
    setStep({ s: "making" });
    const mine = target?.kind === "store";
    const base: StoreGraph = { ...fromAnswers({ ...a, name }), id: mine ? `mine:${target.store.id}` : "build", source: mine ? "mine" : "dream" };
    // Arya's pass names things and fills a cuisine in; the answers' store stands if it cannot.
    // Never wait on it for long: past 40 s the answers' store stands (retest 2026-10-31 #2).
    const late = new Promise<StoreGraph>(ok => window.setTimeout(() => ok(base), 40000));
    const g = await (source.build ? Promise.race([source.build(a, base).catch(() => base), late]) : Promise.resolve(base));
    setStep({ s: "made", graph: { ...g, look: a.look, name } });
  };
  const back = () => {
    const prev: Record<Step["s"], Step["s"]> = { home: "home", which: "home", dreamname: "home", type: target?.kind === "store" ? "which" : "dreamname", look: "type", focus: "look", making: "focus", made: "home" };
    if (step.s === "home") onBack(); else setStep({ s: prev[step.s] } as Step);
  };

  return (
    <div className="qg-build">
      <header className="qg-home-h">
        <button className="qg-ic" onClick={back} aria-label="Back">‹</button>
        <h1>{step.s === "home" ? "Build" : step.s === "made" ? name : "Build a store"}</h1>
        <span />
      </header>

      {step.s === "home" && (
        <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="qg-p">Be the store manager. Answer three questions and Arya builds the whole store for you to walk.</p>
          <button className="qg-bigchoice" onClick={() => setStep({ s: "which" })}>
            <b>Draw my store</b><span>A store you shop at, the way you remember it. It becomes your own map of it.</span>
          </button>
          <button className="qg-bigchoice dream" onClick={() => { setTarget({ kind: "dream", name: "" }); setStep({ s: "dreamname" }); }}>
            <b>Dream store</b><span>Make one up. Play it any time; it never changes a real store.</span>
          </button>
          {saved.length > 0 && (
            <div className="qg-card">
              <h3>Your stores</h3>
              {saved.map(m => (
                <div key={m.key} className="qg-saved">
                  <span><b>{m.name}</b><small>{m.kind === "store" ? "Your map" : "Dream store"} · {m.graph.zones.length} sections</small></span>
                  <button className="qg-mini-btn" onClick={() => onWalk(m.graph, m.name)}>Walk it</button>
                  <button className="qg-mini-btn ghost" onClick={() => { setTarget(m.kind === "store" ? { kind: "store", store: { id: m.storeId || m.key, name: m.name, area: "", kind: "mapped" } } : { kind: "dream", name: m.name }); setStep({ s: "made", graph: m.graph, saved: m }); }}>Change</button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {step.s === "which" && (
        <Q kicker="Draw my store" title="Which store?">
          {(stores || []).map(st => (
            <button key={st.id} className="qg-store" onClick={() => { setTarget({ kind: "store", store: st }); setA(x => ({ ...x, type: guessType(st.name) })); setStep({ s: "type" }); }}>
              <span><b>{st.name}</b><small>{st.area}</small></span>
            </button>
          ))}
          {stores && !stores.length && <p className="qg-p">{findStore ? "Find the store you shop at, or build a dream store." : "Add a store you shop at in Lists first, or build a dream store."}</p>}
          {findStore && stores && <div className="qg-findstore">{findStore(() => loadStores())}</div>}
        </Q>
      )}

      {step.s === "dreamname" && target?.kind === "dream" && (
        <Q kicker="Dream store" title="What's it called?">
          <TextAnswer source={source} value={target.name} placeholder="Snack Palace" onChange={v => setTarget({ kind: "dream", name: v })} />
          <button className="qg-btn primary big" disabled={!target.name.trim()} onClick={() => setStep({ s: "type" })}>Next</button>
        </Q>
      )}

      {step.s === "type" && (
        <Q kicker="1 of 3" title="What kind of store is it?">
          <div className="qg-choices">
            {TYPES.map(t => (
              <button key={t.id} className={"qg-choice" + (a.type === t.id ? " on" : "")} aria-pressed={a.type === t.id} onClick={() => setA(x => ({ ...x, type: t.id }))}>
                <b>{t.name}</b><small>{t.blurb}</small>
              </button>
            ))}
          </div>
          {(a.type === "cuisine" || a.type === "single") && (
            <TextAnswer source={source} value={a.cuisine || ""} placeholder={a.type === "cuisine" ? "Turkish" : "Cheese"} onChange={v => setA(x => ({ ...x, cuisine: v }))} />
          )}
          <button className="qg-btn primary big" disabled={(a.type === "cuisine" || a.type === "single") && !a.cuisine?.trim()} onClick={() => setStep({ s: "look" })}>Next</button>
        </Q>
      )}

      {step.s === "look" && (
        <Q kicker="2 of 3" title="How should it look?">
          <div className="qg-choices">
            {LOOKS.map(l => (
              <button key={l.id} className={"qg-choice look-" + l.id + (a.look === l.id ? " on" : "")} aria-pressed={a.look === l.id} onClick={() => setA(x => ({ ...x, look: l.id as Look }))}>
                <i className="qg-swatch" aria-hidden="true" /><b>{l.name}</b><small>{l.blurb}</small>
              </button>
            ))}
          </div>
          <button className="qg-btn primary big" onClick={() => setStep({ s: "focus" })}>Next</button>
        </Q>
      )}

      {step.s === "focus" && (
        <Q kicker="3 of 3" title="What should be big?">
          <div className="qg-chips" role="group" aria-label="Make big">
            {FOCUS.map(f => {
              const on = a.focus.includes(f.id);
              return <button key={f.id} className={on ? "on" : ""} aria-pressed={on} onClick={() => setA(x => ({ ...x, focus: on ? x.focus.filter(y => y !== f.id) : [...x.focus, f.id as Focus] }))}>{f.name}</button>;
            })}
          </div>
          <p className="qg-small">Anything else? Say it or type it (optional).</p>
          <TextAnswer source={source} value={a.extra || ""} placeholder="An olive bar by the doors" onChange={v => setA(x => ({ ...x, extra: v }))} />
          <button className="qg-btn primary big" onClick={make}>Build my store</button>
        </Q>
      )}

      {step.s === "making" && <div className="qg-making" role="status"><i /><p>Arya is building your store…</p></div>}

      {step.s === "made" && (
        <Made source={source} graph={step.graph} name={name} target={target} saved={step.saved}
          onGraph={g => setStep({ s: "made", graph: g })} onWalk={() => onWalk(step.graph, name)}
          onSaved={m => { setSaved(s => [m, ...s.filter(x => x.key !== m.key)]); setStep({ s: "made", graph: step.graph, saved: m }); }} />
      )}
    </div>
  );
}

function Q({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <motion.div className="qg-q" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={title}>
      <p className="qg-kicker">{kicker}</p>
      <h2>{title}</h2>
      {children}
    </motion.div>
  );
}

/* A typed answer with a mic: Arya transcribes what you say into the box. */
function TextAnswer({ source, value, placeholder, onChange }: { source: QuestSource; value: string; placeholder: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState<{ stop(): Promise<string>; cancel(): void } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => rec?.cancel(), [rec]);
  const mic = async () => {
    if (rec) {
      setRec(null); setBusy(true);
      try { const t = (await rec.stop()).trim(); if (t) onChange(value ? `${value} ${t}` : t); } catch { /* keep what was typed */ }
      setBusy(false);
      return;
    }
    try { setRec(await source.voice!()); } catch { /* no mic: typing still works */ }
  };
  return (
    <div className="qg-say">
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={80} />
      {source.voice && <button className={"qg-mic" + (rec ? " on" : "")} onClick={mic} disabled={busy} aria-label={rec ? "Stop and use what I said" : "Say it"}>{busy ? "…" : rec ? "Stop" : "Say"}</button>}
    </div>
  );
}

function Made({ source, graph, name, target, saved, onGraph, onWalk, onSaved }: {
  source: QuestSource; graph: StoreGraph; name: string; target: Target | null; saved?: SavedMap;
  onGraph: (g: StoreGraph) => void; onWalk: () => void; onSaved: (m: SavedMap) => void;
}) {
  const [say, setSay] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const undo = useRef<StoreGraph[]>([]);
  const change = async () => {
    if (!say.trim() || !source.change) return;
    setBusy(true);
    try {
      const r = await source.change(graph, say.trim());
      if (r.graph !== graph) { undo.current.push(graph); onGraph(r.graph); }
      setReply(r.say); setSay("");
    } catch { setReply("Arya couldn't change that one. Try saying it another way."); }
    setBusy(false);
  };
  const save = async () => {
    if (!source.saveMap || !target) return;
    setBusy(true);
    try {
      const m = await source.saveMap(target.kind === "store" ? { kind: "store", storeId: target.store.id, name, graph } : { kind: "dream", name, graph });
      onSaved(m);
      setReply(target.kind === "store" ? `Saved as your map of ${name}. Your next quest there uses it.` : `Saved. ${name} is in Your stores.`);
    } catch { setReply("Couldn't save just now. Try again in a moment."); }
    setBusy(false);
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Preview graph={graph} name={name} />
      <p className="qg-small">{graph.zones.length} sections · {target?.kind === "store" ? "your map of a real store" : "dream store, played as practice"}</p>
      <div className="qg-made-acts">
        <button className="qg-btn primary big" onClick={onWalk}>Walk it</button>
        {source.saveMap && target && <button className="qg-btn" onClick={save} disabled={busy}>{saved ? "Save changes" : target.kind === "store" ? "Save as my map" : "Save dream store"}</button>}
      </div>
      {source.change && (
        <div className="qg-card">
          <h3>Change something</h3>
          <TextAnswer source={source} value={say} placeholder="Move frozen to the back wall" onChange={setSay} />
          <div className="qg-made-acts">
            <button className="qg-btn" onClick={change} disabled={busy || !say.trim()}>{busy ? "Arya is on it…" : "Do it"}</button>
            {undo.current.length > 0 && <button className="qg-btn ghost" onClick={() => onGraph(undo.current.pop()!)}>Undo</button>}
          </div>
        </div>
      )}
      {reply && <p className="qg-p qg-reply" role="status">{reply}</p>}
    </motion.div>
  );
}

function Preview({ graph, name }: { graph: StoreGraph; name: string }) {
  const trip = useMemo(() => newTrip(buildLayout({ id: "preview", name, area: "", kind: "mapped", items: [], graph, all: true }), [], { practice: true, golden: null }), [graph, name]);
  const noop = () => {};
  return (
    <div className="qg-bpreview">
      <Suspense fallback={<div className="qg-loading">Drawing the store…</div>}>
        <World3D key={JSON.stringify(graph.zones.map(z => [z.id, z.band, z.index, z.size, z.kind])) + graph.look} trip={trip} focus={null}
          onReady={(api: WorldApi) => api.setOverview(true)} onArrive={noop} onWalking={noop} onTapItem={noop} />
      </Suspense>
    </div>
  );
}
