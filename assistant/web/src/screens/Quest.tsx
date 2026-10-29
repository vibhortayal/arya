import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { get, post } from "../lib/api";
import { asset, fmtShort } from "../lib/format";
import { SHOW_RACE } from "../lib/flags";
import { CrewFeed } from "./haul/CrewFeed";
import { qModeLabel } from "./hunt/model";
import { t, useTranslation } from "../i18n";

/* haul.js paintFeed paints the Crew hauls feed above #comm-news and
 * returns at once when the page has no #comm-news. The current app's
 * Quest tab has none (Store news moved to Today), so the feed does not
 * show there; this flag keeps the port the same. Turn it on where the
 * news block comes back. */
const HAS_COMM_NEWS = false;

/* Trips: the hunts behind the Quest game (open and finished, receipts),
 * Crew and Fastest Hands. Reached from the game's home ("trips"); the
 * Quest tab itself is the game (quest/QuestMode.tsx).
 * Port of pwa/index.html #view-community with app.js renderQuestHub
 * (hero card, games, level chip) and quest.js renderCommunity (Crew
 * summary, Fastest Hands board). A game opens its hunt, its Express
 * run or (finished) its Score: nav.show("hunt" | "express" | "score",
 * { session }). */

type SItem = { name: string; checked?: boolean; wild?: boolean };
type Sess = { id: string; store: string; mode: string; state: string; items: SItem[]; created_at?: string;
  started_at?: string; finished_at?: string; receipt_id?: string; shopoff_id?: string };

/* State and mode names: en.json keys. */
const QSTATE_KEY: Record<string, string> = { not_started: "quest.state.notStarted", playing: "quest.state.playing", paused: "hunt.paused", finished: "common.finishedReceiptMissing", done: "quest.state.done" };
const stateLabel = (st: string) => (QSTATE_KEY[st] ? t(QSTATE_KEY[st]) : st);
/* Fastest Hands shows only real household quests. The friends, store
 * and everyone boards were made-up sample players, so they stay
 * hidden (keys quest.scope.* kept) until real boards exist (labels
 * audit, judgement call 1). The Race entry follows lib/flags SHOW_RACE. */

const BasketSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.8 13 11 7.2M15.2 13 13 7.2" /><path d="M3.5 13h17l-1.8 6a2 2 0 0 1-1.9 1.4H7.2A2 2 0 0 1 5.3 19L3.5 13z" /><path d="M9 16.2v2.3M12 16.2v2.3M15 16.2v2.3" /></svg>
);

const progress = (s: Sess) => ({ total: s.items.length, done: s.items.filter(i => i.checked).length });
const closed = (s: Sess) => s.state === "finished" || s.state === "done";

/* The newest hunt that still wants play. A hunt with nothing on it is
 * never "your next action" (owner 2026-10-29); it stays in Your games
 * with End. */
function heroSession(sessions: Sess[]): Sess | undefined {
  return sessions.filter(s => (s.state === "playing" || s.state === "paused" || s.state === "not_started") && s.items.length > 0)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

function durText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  return min >= 60 ? t("common.duration.hm", { h: Math.floor(min / 60), m: min % 60 }) : t("common.duration.m", { m: min });
}

export function Quest() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const { setRing } = useAvatar();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const [sessions, setSessions] = useState<Sess[]>([]);
  const [level, setLevel] = useState<{ level: number; points: number } | null>(null);
  const [albumSub, setAlbumSub] = useState(() => t("quest.albumSub"));
  const [times, setTimes] = useState<Record<string, string>>({});
  const [crew, setCrew] = useState<{ acc: number; pend: number; raceN: number } | null>(null);

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
      if (typeof n === "number") setAlbumSub(n === 0 ? t("quest.noStickers") : t("quest.stickers", { count: n }));
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
    if (!confirm(t("quest.confirmEnd"))) return;
    try { await post(`/api/quest/sessions/${s.id}/state`, { state: "abandoned" }); toast(t("quest.huntEnded")); }
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
  // Every open hunt can be ended from its row (owner 2026-10-29): the
  // newest leads, the rest fold away.
  const [firstOpen, ...rest] = [...openS].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
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
        <span className="g-main"><span className="g-name">{t("quest.gameName", { store: s.store, mode: qModeLabel(s.mode) })}</span>
          <span className="g-meta">{t("quest.stateProgress", { state: stateLabel(s.state), done: p.done, total: p.total })}</span></span>
        {(s.state === "playing" || s.state === "paused") && <span className="track g-bar"><span className="bar" style={{ width: pct + "%" }} /></span>}
        <span className="chev">›</span>
      </button>
    );
  };

  const openRow = (s: Sess) => (
    <div className="earlierrow">{gameRow(s)}
      <button className="btn danger" data-abandon={s.id} type="button" onClick={() => abandon(s)}>{t("quest.abandon")}</button></div>
  );

  const heroCard = () => {
    if (!hero) return null;
    const p = progress(hero);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const fresh = hero.state === "not_started";
    return (
      <article className="herocard">
        <p className="hero-k">{fresh ? t("quest.upNext") : t("quest.inProgress")}</p>
        <h3 className="hero-title">{t("quest.heroTitle", { store: hero.store, mode: qModeLabel(hero.mode) })}</h3>
        <p className="hero-sub">{t("quest.fromYourList", { count: p.total, store: hero.store })}</p>
        <span className="track"><span className="bar" style={{ width: pct + "%" }} /></span>
        <span className="hero-state">{t("quest.stateCollected", { state: stateLabel(hero.state), done: p.done, total: p.total })}</span>
        <button className="btn primary wide" data-hero={hero.id} type="button" onClick={() => open(hero)}>{fresh ? t("quest.start") : t("quest.resume")}<span aria-hidden="true"> ▸</span></button>
        <button className="linkbtn hero-end" data-hero-end={hero.id} type="button" onClick={() => abandon(hero)}>{t("quest.endThisQuest")}</button>
      </article>
    );
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("community"); }}>‹ {t("common.quest")}</a></p>
      <h2 className="largetitle">{t("quest.yourTrips")}</h2>
      <p className="muted nomargin">{t("quest.yourTripsSub")}</p>
      <div className="todayband"><img src={asset("assets/scenes/hero.webp")} alt="" />
        <span id="today-level" className="bandchip" hidden={!level}>{level && <>{t("quest.level", { level: level.level })}{" "}<span>{t("quest.pts", { points: level.points })}</span></>}</span></div>
      <div id="today-hero">{heroCard()}</div>
      <button id="btn-new-hunt" className="gamerow newrow" type="button" onClick={() => nav.show("community")}>
        <span className="g-main"><span className="g-name">{t("quest.newQuest")}</span></span><span className="chev">›</span></button>
      <h3 className="sect" id="games-head" hidden={!sessions.length}>{t("quest.yourGames")}</h3>
      <div id="quest-sessions">
        {sessions.length > 0 && (
          <>
            {firstOpen && openRow(firstOpen)}
            {firstOpen && rest.length > 0 && (
              <details className="g-fold"><summary>{t("quest.otherOpenHunt", { count: rest.length })}</summary>
                {rest.map(s => <Fragment key={s.id}>{openRow(s)}</Fragment>)}
              </details>
            )}
            {done.length > 0 && <><p className="g-group">{t("quest.finished")}</p>{done.map(s => <Fragment key={s.id}>{gameRow(s)}</Fragment>)}</>}
          </>
        )}
      </div>
      <button id="btn-map-store" className="gamerow newrow" type="button" onClick={() => nav.show("mapper")}>
        <img className="rowimg" src={asset("assets/scenes/storefront.webp")} alt="" />
        <span className="g-main"><span className="g-name">{t("common.teachAryaYourStore")}</span><span className="g-sub">{t("quest.20SecondsAnAisleYour")}</span></span>
        <span className="chev">›</span></button>
      <h3 className="sect">{t("quest.crew")}</h3>
      <div id="crew-summary" className="group" hidden={!showCrew}>
        {showCrew && crew && (
          <div className="row"><div className="grow">
            <span className="name">{t("quest.crewLine.friends", { count: crew.acc })}{crew.pend ? " · " + t("quest.crewLine.requests", { count: crew.pend }) : ""}</span>
            {SHOW_RACE || crew.raceN ? <span className="sub">{crew.raceN ? t("quest.crewLine.shopOffsOn", { count: crew.raceN }) : t("quest.crewLine.noShopOff")}</span> : null}</div></div>
        )}
      </div>
      <div className="group">
        {SHOW_RACE && <button className="navrow" data-qnav="view-race" type="button" onClick={() => nav.show("race")}><span className="grow">{t("common.shopOff")}<span className="sub">{t("quest.raceAFriendOnThe")}</span></span><span className="chev">›</span></button>}
        <button className="navrow" data-qnav="view-friends" type="button" onClick={() => nav.show("friends")}><span className="grow">{t("common.friends")}<span className="sub" id="crew-friends-sub">{crew && crew.pend ? t("quest.crewLine.requestsWaiting", { count: crew.pend }) : t("quest.crewLine.addByHandle")}</span></span><span className="chev">›</span></button>
        <button className="navrow" data-qnav="view-album" type="button" onClick={() => nav.show("album")}><span className="grow">{t("common.album")}<span className="sub" id="album-nav-sub">{albumSub}</span></span><span className="chev">›</span></button>
      </div>
      {HAS_COMM_NEWS && <CrewFeed />}
      {/* Hidden for a new user (empty-noise sweep); after a first finished
        * quest it shows the real board, or one line on how to get on it. */}
      <div id="comm-fastest" hidden={!done.length}>
        <h3 className="sect">{t("quest.fastestHands")}</h3>
        {qualifying.length ? <>
          <div id="comm-board" className="group">
            {qualifying.map((x, i) => (
              <div className="row" key={x.s.id}><div className="grow"><span className="name">{i + 1}. {x.s.store}</span>
                <span className="sub">{t("quest.boardRow", { count: x.s.items.length, time: durText(x.ms), date: fmtShort(String(x.s.started_at).slice(0, 10)) })}</span></div>
                <div className="money">{t("quest.perItem", { s: Math.round(x.per / 1000) })}</div></div>))}
          </div>
          <p className="muted">{t("quest.fastestFullHuntsScoredAs")}</p>
        </> : <p className="muted" id="comm-board-empty">{t("quest.noQualifyingHuntsYetFinish")}</p>}
      </div>
    </>
  );
}
