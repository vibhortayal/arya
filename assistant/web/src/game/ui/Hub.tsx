/* The quest hub (home), the store picker and the sticker album.
 * One big action at a time: a new player is pointed at practice
 * first; a returning player at their next real trip. */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { levelOf, played, stageOf, streak, type Profile } from "../core/meta";
import { ALL_STICKERS, PRACTICE_STORE, type QuestSource } from "../core/source";
import type { ShoppingList, StoreSummary } from "../core/types";
import { charArt, img } from "../assets";
import { Bar, KindBadge, Sheet } from "./bits";
import { HowTo } from "./Play";

/* The home panels the player can reorder and hide (card library,
 * owner 2026-10-30): the host's own panels (Map my store, ...) join
 * these by id. "cta" (Ready for a quest) always shows. */
export const HOME_PANELS = ["cta", "album", "stores"] as const;

export function Home({ profile, newbie, list, lists = [], onList, onPractice, onQuest, onAlbum, onExit, extra, onBuild, onAddItems, onPick, panels = {}, order, hidden = [], onEdit }: {
  profile: Profile; newbie: boolean; list: ShoppingList | null; lists?: ShoppingList[]; onList?: (l: ShoppingList) => void;
  onPractice: () => void; onQuest: () => void; onAlbum: () => void; onExit?: () => void; extra?: ReactNode; onBuild?: () => void;
  /* An empty list: the host's way to add items (the Lists tab). */
  onAddItems?: () => void;
  /* A list with its own store: Start goes there; this picks another. */
  onPick?: () => void;
  /* The host's panels by id, and the player's order and hidden ids
   * ("stats" hides the level and streak). onEdit shows Edit. */
  panels?: Record<string, ReactNode>;
  order?: string[];
  hidden?: string[];
  onEdit?: () => void;
}) {
  const lv = levelOf(profile.xp), st = streak(profile.weeks, new Date());
  const [how, setHow] = useState(false);
  const stores = Object.entries(profile.stores);
  const cta = <HomeCta newbie={newbie} list={list} lists={lists} onList={onList} onPractice={onPractice} onQuest={onQuest} onAddItems={onAddItems} onPick={onPick} />;
  const album = <HomeAlbum profile={profile} onAlbum={onAlbum} />;
  const building = <HomeStores stores={stores} />;
  return (
    <div className="qg-home">
      <header className="qg-home-h">
        {onExit && <button className="qg-ic" onClick={onExit} aria-label="Close Quest">‹</button>}
        <h1>Quest</h1>
        {onEdit && <button className="qg-edit" id="qg-editbtn" onClick={onEdit}>Edit</button>}
        <button className="qg-ic" onClick={() => setHow(true)} aria-label="How to play">?</button>
      </header>
      {onBuild && (
        <div className="qg-seg" role="tablist" aria-label="Quest mode">
          <button role="tab" aria-selected="true" className="on">Play</button>
          <button role="tab" aria-selected="false" onClick={onBuild}>Build</button>
        </div>
      )}

      <div className="qg-hero">
        <img src={img("scenes/storefront.webp")} alt="" />
        {/* Show cards only when they matter (owner, 2026-10-30): no
            "Lv 1 · 0 wk streak" before the first real trip. */}
        {played(profile) && !hidden.includes("stats") && (
          <div className="qg-hero-stats">
            <span className="qg-lvchip">Lv {lv.level}</span>
            <Bar value={lv.into} max={lv.need} label="Level progress" />
            <span className="qg-streak" title={`${st.freezesLeft} rest weeks left`}>{st.weeks} wk streak</span>
          </div>
        )}
      </div>

      {(order?.length ? [...order, ...HOME_PANELS, ...Object.keys(panels)] : [...HOME_PANELS, ...Object.keys(panels)])
        .filter((id, i, all) => all.indexOf(id) === i && (id === "cta" || !hidden.includes(id)))
        .map(id => <Fragment key={id}>{id === "cta" ? cta : id === "album" ? album : id === "stores" ? building : panels[id]}</Fragment>)}

      {extra}
      <Sheet open={how} onClose={() => setHow(false)} title="How to play" tall><HowTo /></Sheet>
    </div>
  );
}

function HomeCta({ newbie, list, lists, onList, onPractice, onQuest, onAddItems, onPick }: {
  newbie: boolean; list: ShoppingList | null; lists: ShoppingList[]; onList?: (l: ShoppingList) => void;
  onPractice: () => void; onQuest: () => void; onAddItems?: () => void; onPick?: () => void;
}) {
  return newbie ? (
        <motion.div className="qg-cta" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="qg-kicker">New here? Start with practice</p>
          <h2>Play the Practice Market</h2>
          <p className="qg-p">A pretend store with a short list. Two minutes, no pressure, nothing is saved. You'll learn every move: the route, grabbing, fog and the golden item.</p>
          <button className="qg-btn primary big" onClick={onPractice}>Play practice <span aria-hidden="true">▶</span></button>
          {list?.items.length ? <button className="qg-btn ghost" onClick={onQuest}>Skip to a real quest</button>
            : onAddItems && <button className="qg-btn ghost" onClick={onAddItems}>Add items to your list</button>}
        </motion.div>
      ) : (
        <motion.div className="qg-cta" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="qg-kicker">{list ? `${list.name} · ${list.items.length} items` : "Your list"}</p>
          <h2>Ready for a quest?</h2>
          {lists.length > 1 && onList && (
            <div className="qg-chips qg-lists" role="radiogroup" aria-label="Which list">
              {lists.filter(l => l.items.length).map(l => (
                <button key={l.id} role="radio" aria-checked={l.id === list?.id} className={l.id === list?.id ? "on" : ""} onClick={() => onList(l)}>{l.name} · {l.items.length}</button>
              ))}
            </div>
          )}
          {list?.items.length ? <>
                <button className="qg-btn primary big" onClick={onQuest}>{list.store ? `Start at ${list.store}` : "Start a quest"} <span aria-hidden="true">▶</span></button>
                {list.store && onPick && <button id="qg-otherstore" className="qg-btn ghost" onClick={onPick}>Shop somewhere else</button>}
              </>
            : <>
                <p className="qg-p">Your list is empty. Add what you need, or try practice.</p>
                {onAddItems && <button id="qg-additems" className="qg-btn primary big" onClick={onAddItems}>Add items</button>}
              </>}
          <button className="qg-btn ghost" onClick={onPractice}>Practice</button>
        </motion.div>
      );
}

function HomeAlbum({ profile, onAlbum }: { profile: Profile; onAlbum: () => void }) {
  /* The album shows up with its first sticker, not as "0 of 20". */
  return profile.stickers.length > 0 ? <div className="qg-tiles">
        <button className="qg-tile" onClick={onAlbum}>
          <div className="qg-tile-art">{ALL_STICKERS.slice(0, 3).map(s => <img key={s} src={charArt(s)} alt="" className={profile.stickers.includes(s) ? "" : "locked"} />)}</div>
          <b>Sticker album</b><small>{profile.stickers.length} of {ALL_STICKERS.length}</small>
        </button>
      </div> : null;
}

function HomeStores({ stores }: { stores: [string, Profile["stores"][string]][] }) {
  return stores.length > 0 ? (
        <div className="qg-card">
          <h3>Stores you're building</h3>
          {stores.map(([id, g]) => { const s = stageOf(g); return (
            <div key={id} className="qg-growth"><span>{id === PRACTICE_STORE.id ? "Practice" : id.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")}</span><Bar value={s.pct} max={100} label="Mapped" /><small>{s.name}</small></div>
          ); })}
        </div>
      ) : null;
}

export function Pick({ source, newbie, first, onPick, onPractice, onBack }: { source: QuestSource; newbie: boolean; first?: string; onPick: (s: StoreSummary) => void; onPractice: () => void; onBack: () => void }) {
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
  // The list's own store leads; the rest are the player's stores.
  const lead = (rows: StoreSummary[]) => {
    const f = first?.trim().toLowerCase();
    return f ? [...rows].sort((a, b) => Number(b.name.trim().toLowerCase() === f) - Number(a.name.trim().toLowerCase() === f)) : rows;
  };
  const rows = searching ? found || [] : lead(near);
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
      <p className="qg-kicker">{searching ? (q ? `Results for "${q}"` : "All stores") : "Your stores"}</p>
      <div className="qg-stores">
        {rows.map(s => (
          <button key={s.id} className="qg-store" onClick={() => onPick(s)}>
            <span className="qg-pin" aria-hidden="true"><i className={"qg-kdot " + s.kind} /></span>
            <span><b>{s.name}</b><small>{s.area}{s.miles != null ? ` · ${s.miles} mi` : ""}{s.seen ? ` · ${s.seen}` : ""}</small></span>
            <KindBadge kind={s.kind} />
          </button>
        ))}
        {searching && found && !found.length && <p className="qg-p">No store by that name yet. Pick the closest one and Arya will use a typical layout.</p>}
        {!searching && <button className="qg-store find" onClick={() => setSearching(true)}><span className="qg-pin"><i className="qg-kdot find" /></span><span><b>Find another store</b><small>Any store works: unmapped ones play as a simulated store</small></span></button>}
      </div>
      <p className="qg-legendrow"><KindBadge kind="mapped" /> shelves are real <KindBadge kind="partial" /> some fog <KindBadge kind="simulated" /> a typical layout</p>
    </div>
  );
}

export function Album({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  return (
    <div className="qg-album">
      <header className="qg-home-h"><button className="qg-ic" onClick={onBack} aria-label="Back">‹</button><h1>Sticker album</h1><span /></header>
      <p className="qg-p">{profile.stickers.length} of {ALL_STICKERS.length}. Stickers come from things you really buy. Shiny ones were found where nobody had mapped yet.</p>
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
