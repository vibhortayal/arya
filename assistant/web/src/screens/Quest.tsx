import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { get, post } from "../lib/api";
import { qModeLabel } from "./hunt/model";
import { t, useTranslation } from "../i18n";


/* Trips: the hunts behind the Quest game (open and finished, receipts),
 * Crew and Fastest Hands. Reached from the game's home ("trips"); the
 * Quest tab itself is the game (quest/QuestMode.tsx).
 * History only (usability audit, owner-approved 2026-10-29): the trip to
 * resume (Resume, End), other open trips with End, and finished ones.
 * New quest, mapping, level, album, Crew and Fastest Hands left this
 * page: they live in Quest (or wait for real cross-account play), and
 * their screens stay reachable by route. A game opens its hunt, its Express
 * run or (finished) its Score: nav.show("hunt" | "express" | "score",
 * { session }). */

type SItem = { name: string; checked?: boolean; wild?: boolean };
type Sess = { id: string; store: string; mode: string; state: string; items: SItem[]; created_at?: string;
  started_at?: string; finished_at?: string; receipt_id?: string; shopoff_id?: string };

/* State and mode names: en.json keys. */
const QSTATE_KEY: Record<string, string> = { not_started: "quest.state.notStarted", playing: "quest.state.playing", paused: "hunt.paused", finished: "common.finishedReceiptMissing", done: "quest.state.done" };
const stateLabel = (st: string) => (QSTATE_KEY[st] ? t(QSTATE_KEY[st]) : st);

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


export function Quest() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const { setRing } = useAvatar();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const [sessions, setSessions] = useState<Sess[]>([]);

  const load = useCallback(async () => {
    let list: Sess[] = [];
    try { list = (await get("/api/quest/sessions")).sessions || []; } catch { list = []; }
    if (!live.current) return;
    setSessions(list);
    // The avatar's level ring (the level itself lives in Quest progress).
    get("/api/quest/profile").then(p => {
      if (!p || !live.current || !p.level) return;
      const span = (p.next_level_at - p.level_floor) || 1;
      setRing({ pct: Math.max(0, Math.min(100, Math.round((p.points - p.level_floor) / span * 100))), level: p.level });
    }).catch(() => {});
  }, [setRing]);
  useEffect(() => { load().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (s: Sess) => {
    if (closed(s)) nav.show("score", { session: s });
    // A Quest trip resumes in the Quest game (usability audit pain 3);
    // Express and Shop-Off keep their screens.
    else if (s.mode === "quest" && !s.shopoff_id) nav.show("community", { resume: s.id });
    else nav.show(s.mode === "express" ? "express" : "hunt", { session: s });
  };

  async function abandon(s: Sess) {
    if (!confirm(t("quest.confirmEnd"))) return;
    try { await post(`/api/quest/sessions/${s.id}/state`, { state: "abandoned" }); toast(t("quest.huntEnded")); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    load().catch(showErr);
  }


  const hero = heroSession(sessions);
  // The hero trip is not listed again below it (usability audit).
  const openS = sessions.filter(s => !closed(s) && s.id !== hero?.id), done = sessions.filter(closed);
  // Every open trip can be ended from its row (owner 2026-10-29), newest first.
  const open_ = [...openS].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

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
      <div id="today-hero">{heroCard()}</div>
      <h3 className="sect" id="games-head" hidden={!openS.length && !done.length}>{t("quest.yourGames")}</h3>
      <div id="quest-sessions">
        {open_.map(s => <Fragment key={s.id}>{openRow(s)}</Fragment>)}
        {done.length > 0 && <><p className="g-group">{t("quest.finished")}</p>{done.map(s => <Fragment key={s.id}>{gameRow(s)}</Fragment>)}</>}
      </div>
    </>
  );
}
