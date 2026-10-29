/* The quest hub (home), the store picker and the sticker album.
 * One big action at a time: a new player is pointed at practice
 * first; a returning player at their next real trip. */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BUNDLES, bundleProgress, levelOf, stageOf, streak, type Profile } from "../core/meta";
import { ALL_STICKERS, PRACTICE_STORE, type QuestSource } from "../core/source";
import type { ShoppingList, StoreSummary } from "../core/types";
import { charArt, img } from "../assets";
import { Bar, KindBadge, Sheet } from "./bits";
import { HowTo } from "./Play";

export function Home({ profile, newbie, list, onPractice, onQuest, onAlbum, onExit }: {
  profile: Profile; newbie: boolean; list: ShoppingList | null;
  onPractice: () => void; onQuest: () => void; onAlbum: () => void; onExit?: () => void;
}) {
  const lv = levelOf(profile.xp), st = streak(profile.weeks, new Date());
  const [how, setHow] = useState(false);
  const stores = Object.entries(profile.stores);
  return (
    <div className="qg-home">
      <header className="qg-home-h">
        {onExit && <button className="qg-ic" onClick={onExit} aria-label="Close Quest">‹</button>}
        <h1>Quest</h1>
        <button className="qg-ic" onClick={() => setHow(true)} aria-label="How to play">?</button>
      </header>

      <div className="qg-hero">
        <img src={img("scenes/storefront.webp")} alt="" />
        <div className="qg-hero-stats">
          <span className="qg-lvchip">Lv {lv.level}</span>
          <Bar value={lv.into} max={lv.need} label="Level progress" />
          <span className="qg-streak" title={`${st.freezesLeft} rest weeks left`}>🔥 {st.weeks} wk</span>
        </div>
      </div>

      {newbie ? (
        <motion.div className="qg-cta" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="qg-kicker">New here? Start with practice</p>
          <h2>Play the Practice Market</h2>
          <p className="qg-p">A pretend store with a short list. Two minutes, no pressure, nothing is saved. You'll learn every move: the route, grabbing, fog and the golden item.</p>
          <button className="qg-btn primary big" onClick={onPractice}>Play practice <span aria-hidden="true">▶</span></button>
          <button className="qg-btn ghost" onClick={onQuest}>Skip to a real quest</button>
        </motion.div>
      ) : (
        <motion.div className="qg-cta" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="qg-kicker">{list ? `${list.name} · ${list.items.length} items` : "Your list"}</p>
          <h2>Ready for a quest?</h2>
          <button className="qg-btn primary big" onClick={onQuest}>Start a quest <span aria-hidden="true">▶</span></button>
          <button className="qg-btn ghost" onClick={onPractice}>Practice</button>
        </motion.div>
      )}

      <div className="qg-tiles">
        <button className="qg-tile" onClick={onAlbum}>
          <div className="qg-tile-art">{ALL_STICKERS.slice(0, 3).map(s => <img key={s} src={charArt(s)} alt="" className={profile.stickers.includes(s) ? "" : "locked"} />)}</div>
          <b>Sticker album</b><small>{profile.stickers.length} of {ALL_STICKERS.length}</small>
        </button>
        <div className="qg-tile">
          <b>Bundles</b>
          {BUNDLES.map(b => { const p = bundleProgress(profile.found, b); return <small key={b.id}>{p.done ? "✓ " : `${p.met.filter(Boolean).length}/${b.slots.length} `}{b.name.replace(" bundle", "")}</small>; })}
        </div>
      </div>

      {stores.length > 0 && (
        <div className="qg-card">
          <h3>Stores you're building</h3>
          {stores.map(([id, g]) => { const s = stageOf(g); return (
            <div key={id} className="qg-growth"><span>{id === PRACTICE_STORE.id ? "Practice" : id.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")}</span><Bar value={s.pct} max={100} label="Mapped" /><small>{s.name}</small></div>
          ); })}
        </div>
      )}

      <Sheet open={how} onClose={() => setHow(false)} title="How to play" tall><HowTo /></Sheet>
    </div>
  );
}

export function Pick({ source, newbie, onPick, onPractice, onBack }: { source: QuestSource; newbie: boolean; onPick: (s: StoreSummary) => void; onPractice: () => void; onBack: () => void }) {
  const [near, setNear] = useState<StoreSummary[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StoreSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => { void source.nearbyStores().then(setNear); }, [source]);
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => void source.findStores(q).then(setFound), 180);
    return () => clearTimeout(t);
  }, [q, searching, source]);
  const rows = searching ? found || [] : near;
  return (
    <div className="qg-pick">
      <header className="qg-home-h"><button className="qg-ic" onClick={onBack} aria-label="Back">‹</button><h1>Where are you shopping?</h1><span /></header>
      <button className={"qg-store prac" + (newbie ? " rec" : "")} onClick={onPractice}>
        <img src={charArt("compass.webp")} alt="" />
        <span><b>Practice Market</b><small>{newbie ? "Recommended first: learn in 2 minutes" : "Pretend store, nothing is saved"}</small></span>
        <KindBadge kind="practice" practice />
      </button>
      <div className="qg-search">
        <input value={q} onFocus={() => setSearching(true)} onChange={e => { setQ(e.target.value); setSearching(true); }} placeholder="Search stores by name or area" aria-label="Search stores" />
        {searching && <button onClick={() => { setSearching(false); setQ(""); }}>Cancel</button>}
      </div>
      <p className="qg-kicker">{searching ? (q ? `Results for "${q}"` : "All stores") : "Near you"}</p>
      <div className="qg-stores">
        {rows.map(s => (
          <button key={s.id} className="qg-store" onClick={() => onPick(s)}>
            <span className="qg-pin" aria-hidden="true">{s.kind === "mapped" ? "🗺️" : s.kind === "partial" ? "🌫️" : "📐"}</span>
            <span><b>{s.name}</b><small>{s.area}{s.miles != null ? ` · ${s.miles} mi` : ""}{s.seen ? ` · ${s.seen}` : ""}</small></span>
            <KindBadge kind={s.kind} />
          </button>
        ))}
        {searching && found && !found.length && <p className="qg-p">No store by that name yet. Pick the closest one and Arya will use a typical layout.</p>}
        {!searching && <button className="qg-store find" onClick={() => setSearching(true)}><span className="qg-pin">🔍</span><span><b>Find another store</b><small>Any store works: unmapped ones play as a simulated store</small></span></button>}
      </div>
      <p className="qg-legendrow"><KindBadge kind="mapped" /> shelves are real <KindBadge kind="partial" /> some fog <KindBadge kind="simulated" /> a typical layout</p>
    </div>
  );
}

export function Album({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  return (
    <div className="qg-album">
      <header className="qg-home-h"><button className="qg-ic" onClick={onBack} aria-label="Back">‹</button><h1>Sticker album</h1><span /></header>
      <p className="qg-p">{profile.stickers.length} of {ALL_STICKERS.length}. Stickers come from things you really buy. ✨ Shiny ones were found where nobody had mapped yet.</p>
      <div className="qg-grid">
        {ALL_STICKERS.map((s, i) => {
          const have = profile.stickers.includes(s), shiny = profile.shiny.includes(s);
          return (
            <motion.div key={s} className={"qg-slot" + (have ? " have" : "") + (shiny ? " shiny" : "")} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.025 }}>
              <img src={charArt(s)} alt={have ? s.replace(".webp", "").replace("-", " ") : "Not found yet"} />
              <small>{have ? s.replace(".webp", "").replace("-", " ") : "?"}</small>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
