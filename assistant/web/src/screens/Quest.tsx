import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { asset, fmtShort } from "../lib/format";

/* Port of pwa/index.html #view-community with app.js renderQuestHub
 * (hero card, games, level chip) and quest.js renderCommunity (Crew
 * summary, Fastest Hands board). A game opens its hunt: the hunt,
 * Express and Score screens are not ported yet, so they get
 * nav.show("hunt" | "express" | "score", { session }). */

type SItem = { name: string; checked?: boolean; wild?: boolean };
type Sess = { id: string; store: string; mode: string; state: string; items: SItem[]; created_at?: string;
  started_at?: string; finished_at?: string; receipt_id?: string; shopoff_id?: string };
type Scope = "household" | "friends" | "store" | "global";

const QSTATE_LBL: Record<string, string> = { not_started: "Not started", playing: "Playing", paused: "Paused", finished: "Finished · Receipt missing", done: "Finished · Receipt attached ✓" };
const QMODE_LBL: Record<string, string> = { quest: "Quest", express: "Express" };
const SCOPES: [Scope, string][] = [["household", "Household"], ["friends", "Friends"], ["store", "Store"], ["global", "Global"]];
const SAMPLES: Record<string, [string, number][]> = {
  friends: [["@sample-mina", 33], ["@sample-dev", 38]],
  store: [["@sample-ana", 31], ["@sample-ravi", 36]],
  global: [["@sample-ana", 31], ["@sample-mina", 33], ["@sample-dev", 38]],
};

const BasketSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.8 13 11 7.2M15.2 13 13 7.2" /><path d="M3.5 13h17l-1.8 6a2 2 0 0 1-1.9 1.4H7.2A2 2 0 0 1 5.3 19L3.5 13z" /><path d="M9 16.2v2.3M12 16.2v2.3M15 16.2v2.3" /></svg>
);

const progress = (s: Sess) => ({ total: s.items.length, done: s.items.filter(i => i.checked).length });
const closed = (s: Sess) => s.state === "finished" || s.state === "done";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* The newest hunt that still wants play. */
function heroSession(sessions: Sess[]): Sess | undefined {
  return sessions.filter(s => s.state === "playing" || s.state === "paused" || s.state === "not_started")
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

function durText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export function Quest() {
  const nav = useNav();
  const { toast, showErr } = useToast();
  const { setRing } = useAvatar();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const [sessions, setSessions] = useState<Sess[]>([]);
  const [level, setLevel] = useState<{ level: number; points: number } | null>(null);
  const [albumSub, setAlbumSub] = useState("Stickers from your hunts");
  const [times, setTimes] = useState<Record<string, string>>({});
  const [crew, setCrew] = useState<{ acc: number; pend: number; raceN: number } | null>(null);
  const [scope, setScope] = useState<Scope>("household");

  const load = useCallback(async () => {
    let list: Sess[] = [];
    try { list = (await get("/api/quest/sessions")).sessions || []; } catch { list = []; }
    if (!live.current) return;
    setSessions(list);
    get("/api/quest/profile").then(p => {
      if (!p || !live.current) return;
      if (p.level) {
        setLevel({ level: p.level, points: p.points });
        const span = (p.next_level_at - p.level_floor) || 1;
        const pct = Math.max(0, Math.min(100, Math.round((p.points - p.level_floor) / span * 100)));
        setRing({ pct, level: p.level });
      }
      const n = p.album && p.album.stickers;
      if (typeof n === "number") setAlbumSub(n === 0 ? "No stickers yet" : n === 1 ? "1 sticker" : `${n} stickers`);
    }).catch(() => {});
    const [archive, fr] = await Promise.all([
      get("/api/quest/receipts").catch(() => ({ receipts: [] })),
      get("/api/quest/friends").catch(() => ({ friends: [] })),
    ]);
    if (!live.current) return;
    setTimes(Object.fromEntries((archive.receipts || []).map((r: any) => [r.receipt_id, r.purchased_at])));
    const friends: any[] = fr.friends || [];
    const raceN = new Set(list.filter(s => s.shopoff_id && s.state !== "done" && s.state !== "finished").map(s => s.shopoff_id)).size;
    setCrew({ acc: friends.filter(f => f.status === "accepted").length, pend: friends.filter(f => f.status === "pending_in").length, raceN });
  }, [setRing]);
  useEffect(() => { load().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (s: Sess) => {
    if (closed(s)) nav.show("score", { session: s });
    else nav.show(s.mode === "express" ? "express" : "hunt", { session: s });
  };

  async function abandon(s: Sess) {
    if (!confirm("End this hunt? It leaves Quest and cannot be resumed.")) return;
    try { await post(`/api/quest/sessions/${s.id}/state`, { state: "abandoned" }); toast("Hunt ended."); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    load().catch(showErr);
  }

  const finishMs = (s: Sess): number | null => {
    if (!s.started_at) return null;
    let end = s.finished_at;
    if (s.receipt_id && times[s.receipt_id]) end = times[s.receipt_id];
    if (!end) return null;
    const ms = new Date(end).getTime() - new Date(s.started_at).getTime();
    return ms > 0 ? ms : null;
  };

  const hero = heroSession(sessions);
  const openS = sessions.filter(s => !closed(s)), done = sessions.filter(closed);
  const heroOpen = heroSession(openS);
  const rest = openS.filter(s => s !== heroOpen);
  const qualifying = sessions.filter(s => s.state === "done" && s.items.length >= 8)
    .map(s => ({ s, ms: finishMs(s) })).filter(x => x.ms != null)
    .map(x => ({ ...x, ms: x.ms as number, per: (x.ms as number) / x.s.items.length }))
    .sort((a, b) => a.per - b.per);
  const showCrew = !!crew && (crew.acc > 0 || crew.pend > 0 || crew.raceN > 0);

  const gameRow = (s: Sess) => {
    const p = progress(s);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    return (
      <button className="gamerow" data-sess={s.id} type="button" onClick={() => open(s)}>
        <span className="storeic"><BasketSvg /></span>
        <span className="g-main"><span className="g-name">{s.store} — {QMODE_LBL[s.mode] || s.mode}</span>
          <span className="g-meta">{QSTATE_LBL[s.state] || s.state} · {p.done} of {p.total}</span></span>
        {(s.state === "playing" || s.state === "paused") && <span className="track g-bar"><span className="bar" style={{ width: pct + "%" }} /></span>}
        <span className="chev">›</span>
      </button>
    );
  };

  const heroCard = () => {
    if (!hero) return null;
    const p = progress(hero);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const fresh = hero.state === "not_started";
    return (
      <article className="herocard">
        <p className="hero-k">{fresh ? "Up next — your next game" : "In progress — your next action"}</p>
        <h3 className="hero-title">{hero.store} · {QMODE_LBL[hero.mode] || hero.mode}</h3>
        <p className="hero-sub">{plural(p.total, "item")} · from your {hero.store} list</p>
        <span className="track"><span className="bar" style={{ width: pct + "%" }} /></span>
        <span className="hero-state">{QSTATE_LBL[hero.state] || hero.state} · {p.done} of {p.total} collected</span>
        <button className="btn primary wide" data-hero={hero.id} type="button" onClick={() => open(hero)}>{fresh ? "Start ▸" : "Resume ▸"}</button>
      </article>
    );
  };

  return (
    <>
      <h2 className="largetitle">Quest</h2>
      <p className="muted nomargin">Your list, as a treasure hunt through the store.</p>
      <div className="todayband"><img src={asset("assets/scenes/hero.webp")} alt="" />
        <span id="today-level" className="bandchip" hidden={!level}>{level && <>Level {level.level} <span>· {level.points} pts</span></>}</span></div>
      <div id="today-hero">{heroCard()}</div>
      <button id="btn-new-hunt" className="gamerow newrow" type="button" onClick={() => nav.show("store")}>
        <span className="g-main"><span className="g-name">+ New hunt</span></span><span className="chev">›</span></button>
      <h3 className="sect" id="games-head" hidden={!sessions.length}>Your games</h3>
      <div id="quest-sessions">
        {sessions.length > 0 && (
          <>
            {heroOpen && gameRow(heroOpen)}
            {heroOpen && rest.length > 0 && (
              <details className="g-fold"><summary>{rest.length} other open hunt{rest.length === 1 ? "" : "s"}</summary>
                {rest.map(s => <div className="earlierrow" key={s.id}>{gameRow(s)}
                  <button className="btn danger" data-abandon={s.id} type="button" onClick={() => abandon(s)}>Abandon</button></div>)}
              </details>
            )}
            {done.length > 0 && <><p className="g-group">Finished</p>{done.map(s => <Fragment key={s.id}>{gameRow(s)}</Fragment>)}</>}
          </>
        )}
      </div>
      <button id="btn-map-store" className="gamerow newrow" type="button" onClick={() => nav.show("mapper")}>
        <img className="rowimg" src={asset("assets/scenes/storefront.webp")} alt="" />
        <span className="g-main"><span className="g-name">Teach Arya your store</span><span className="g-sub">20 seconds an aisle. Your next hunt gets faster.</span></span>
        <span className="chev">›</span></button>
      <h3 className="sect">Crew</h3>
      <div id="crew-summary" className="group" hidden={!showCrew}>
        {showCrew && crew && (
          <div className="row"><div className="grow">
            <span className="name">{plural(crew.acc, "friend")}{crew.pend ? ` · ${plural(crew.pend, "request")}` : ""}</span>
            <span className="sub">{crew.raceN ? `${plural(crew.raceN, "Shop-Off")} on` : "No Shop-Off on right now"}</span></div></div>
        )}
      </div>
      <div className="group">
        <button className="navrow" data-qnav="view-race" type="button" onClick={() => nav.show("race")}><span className="grow">Shop-Off<span className="sub">Race a friend on the same list</span></span><span className="chev">›</span></button>
        <button className="navrow" data-qnav="view-friends" type="button" onClick={() => nav.show("friends")}><span className="grow">Friends<span className="sub" id="crew-friends-sub">{crew && crew.pend ? `${plural(crew.pend, "request")} waiting` : "Add by handle, accept requests"}</span></span><span className="chev">›</span></button>
        <button className="navrow" data-qnav="view-album" type="button" onClick={() => nav.show("album")}><span className="grow">Album<span className="sub" id="album-nav-sub">{albumSub}</span></span><span className="chev">›</span></button>
      </div>
      <div id="comm-fastest" hidden={!qualifying.length}>
        <div className="seg" id="comm-scopes">
          {SCOPES.map(([k, label]) => (
            <button key={k} className="chip" data-scope={k} aria-pressed={scope === k} type="button" onClick={() => setScope(k)}>{label}</button>
          ))}
        </div>
        <h3 className="sect">Fastest Hands</h3>
        <div id="comm-board" className="group">
          {scope !== "household"
            ? (SAMPLES[scope] || []).map(([h, per], i) => (
              <div className="row" key={h}><div className="grow"><span className="name">{i + 1}. {h}<span className="samplepill">Sample</span></span>
                <span className="sub">Example only. Real boards fill in as friends play.</span></div>
                <div className="money">{per}s / item</div></div>))
            : qualifying.length
              ? qualifying.map((x, i) => (
                <div className="row" key={x.s.id}><div className="grow"><span className="name">{i + 1}. {x.s.store}</span>
                  <span className="sub">{x.s.items.length} items · {durText(x.ms)} · {fmtShort(String(x.s.started_at).slice(0, 10))}</span></div>
                  <div className="money">{Math.round(x.per / 1000)}s / item</div></div>))
              : <Empty>No qualifying hunts yet — finish a hunt with 8 or more items and a receipt.</Empty>}
        </div>
        <p className="muted">Fastest full hunts, scored as time per item. A hunt needs 8 or more items to qualify. Times come from the receipt — the receipt is the referee.</p>
      </div>
    </>
  );
}
