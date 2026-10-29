import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { AddReceiptSheet } from "../ui/AddReceiptSheet";
import { Row } from "../ui/kit";
import { api, get } from "../lib/api";
import { asset, money } from "../lib/format";
import { faceFor, useCharacters } from "../lib/characters";
import { Q, qModeLabel, QPTS, qBossStatus, qHaulPoints, qLoadStoreReports, qProgress, type Session } from "./hunt/model";
import { qConfetti, qShowMilestone, qTone } from "./hunt/fx";
import { HaulPhoto } from "./score/HaulPhoto";
import { ScoreRow } from "./haul/ScoreRow";
import { ShareSheet, type ShareKind, type ShareReq } from "./haul/Share";
import { H, afterFinish, shareReady } from "./haul/state";
import { maybeLevelUp } from "./album/levelup";
import { t, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-score and quest.js openScore,
 * qHaulHtml, qAfterHaul, qCountUp, qHuntDuration. Opened with
 * nav.show / replace("score", { session }). The Score is the closure:
 * it says whether the receipt is attached and offers Add receipt when
 * it is not. Express is plain: no points, level, badges or characters.
 * The haul row (haul.js scoreRow) opens the haul card, the receipt
 * check, the reveal and the album; Share this run opens the share
 * cards (share.js). */

type Badge = { id: string; name: string; criteria: string; detail: string; earned?: boolean };
type Profile = { handle?: string; avatar?: string; level?: number; points: number; level_floor: number; next_level_at: number; badges: Badge[] };
type Receipt = { merchant: string; items: number; total: number; returns_total?: number; totals_reconcile?: boolean; purchased_at?: string };
type Data = { sess: Session; receipt: Receipt | null; profile: Profile | null; seen: Set<string> };

const durText = (ms: number) => {
  const min = Math.floor(Math.max(0, Math.round(ms / 1000)) / 60);
  return min >= 60 ? t("common.duration.hm", { h: Math.floor(min / 60), m: min % 60 }) : t("common.duration.m", { m: min });
};
function huntDuration(sess: Session, receipt: Receipt | null): number | null {
  if (!sess.started_at) return null;
  const endIso = (receipt && receipt.purchased_at) || sess.finished_at;
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(sess.started_at).getTime();
  return ms >= 0 ? ms : null;
}
const readSeen = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem("arya-seen-badges") || "[]")); } catch { return new Set(); }
};

/* The haul counts up from 0 (qCountUp), easing out. */
function CountUp({ to, ms = 900 }: { to: number; ms?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      if (el.current) el.current.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span id="haul-n" ref={el}>0</span>;
}

export function Score() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency } = useSession();
  const { toast } = useToast();
  useCharacters();
  const first = (nav.params.session as Session | undefined) || Q.current;
  const [data, setData] = useState<Data | null>(null);
  const [ar, setAr] = useState(false);
  const [share, setShare] = useState<ShareReq | null>(null);
  const m = (n: number) => money(n, currency);

  const load = useCallback(async () => {
    let sess = first;
    if (!sess) return;
    if (sess.state === "done") {
      // The view carries what the raw session does not: wild finds and my reports.
      const fresh = await api<Session>(`/api/quest/sessions/${encodeURIComponent(sess.id)}`).catch(() => null);
      if (fresh) sess = fresh;
    }
    Q.current = sess;
    if ((sess.items || []).some(i => !i.checked) && !(Q.storeReports || []).some(r => r.session_id === sess!.id)) {
      await qLoadStoreReports(sess.store);
    }
    const plain = sess.mode === "express";
    const receipt = sess.receipt_id
      ? await get<Receipt>(`/api/quest/receipts/${encodeURIComponent(String(sess.receipt_id))}`).catch(() => null) : null;
    let profile = await get<Profile>("/api/quest/profile").catch(() => null);
    if (plain) profile = null;
    if (profile) maybeLevelUp(profile);
    try { localStorage.setItem("arya-hunted", "1"); } catch { /* storage unavailable */ }
    const seen = readSeen();
    if (profile && !plain) {
      const fresh = profile.badges.find(b => b.earned && !seen.has(b.id));
      if (fresh) H.newBadge = { id: fresh.id, name: fresh.name };   // the share card's badge look
      try {
        localStorage.setItem("arya-seen-badges", JSON.stringify(profile.badges.filter(b => b.earned).map(b => b.id)));
      } catch { /* storage unavailable */ }
    }
    setData({ sess, receipt, profile, seen });
    // A new level (remembered on this device) gets its own burst.
    if (!plain && sess.state === "done" && profile && profile.level) {
      let last = 0;
      try { last = Number(localStorage.getItem("arya-level") || 0); } catch { /* storage unavailable */ }
      if (last && profile.level > last) {
        setTimeout(() => { qShowMilestone(t("score.levelUpMilestone", { level: profile!.level })); qConfetti(); qTone([523, 784, 1047, 1319], 0.1); }, 700);
      } else if (qProgress(sess).done) {
        setTimeout(() => qTone([660, 880, 1175], 0.09), 300);
      }
      try { localStorage.setItem("arya-level", String(profile.level)); } catch { /* storage unavailable */ }
    }
  }, [first]);

  useEffect(() => {
    setData(null);
    let live = true;
    load().catch(e => { if (live) toast(t("common.couldNotLoad", { error: e instanceof Error ? e.message : String(e) })); });
    return () => { live = false; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div id="score-body"><div className="group"><p className="empty">{t("score.scoringTheHunt")}</p></div></div>;

  const { sess, receipt, profile, seen } = data;
  const plain = sess.mode === "express";
  const p = qProgress(sess);
  const dur = huntDuration(sess, receipt);
  const attached = sess.state === "done";
  const wildNames = [...new Set([...((sess.wild_finds as string[] | undefined) || []),
    ...sess.items.filter(i => i.wild).map(i => i.name)])];

  const parts = [`${p.done} × ${QPTS.item}`];
  if (p.total && p.done === p.total) parts.push(t("score.partFullHaul", { pts: QPTS.haul }));
  if (qBossStatus(sess) === "found") parts.push(t("score.partBoss", { pts: QPTS.boss }));
  if (attached) parts.push(t("score.partReceipt", { pts: QPTS.receipt }));
  const pts = qHaulPoints(sess, attached);

  // quest.js openScore shareCtx / haulCtx. Share your haul waits for
  // the haul view, so a hidden or removed sticker never reaches the card.
  async function openShare(kind: ShareKind) {
    const base = { sess, profile: profile as Record<string, unknown> | null, haulPhotoURL: H.haulPhotoURL || null };
    if (kind !== "haul") { setShare({ kind, ctx: base }); return; }
    const c = await shareReady(sess, toast);
    if (c) setShare({ kind, ctx: { ...c, profile: base.profile, haulPhotoURL: base.haulPhotoURL, newBadge: H.newBadge || null } });
  }

  const lvlFill = profile && profile.level
    ? Math.max(0, Math.min(100, Math.round(100 * (profile.points - profile.level_floor) / Math.max(1, profile.next_level_at - profile.level_floor)))) : 0;

  return (
    <div id="score-body">
      {attached && !plain && <img className="scoreparty" src={asset("assets/scenes/score-party.webp")} alt={t("score.theCastCelebratesAroundThe")} />}
      <div className="scorehero">
        <p className="hero-k">{attached ? t("score.receiptAttached") : t("common.finishedReceiptMissing")}</p>
        <h2 className="largetitle" style={{ fontSize: 28 }}>{t(plain ? "score.titleShoppingDone" : "score.titleHuntFinished", { store: sess.store })}</h2>
        <p className="muted nomargin">{t(plain ? "score.progressGot" : "score.progressCollected", { mode: qModeLabel(sess.mode), done: p.done, total: p.total })}</p>
      </div>
      {!plain && (
        <div className="haul">
          <p className="haul-k">{attached ? t("score.haulBanked") : t("score.yourHaul")}</p>
          <p className="haul-pts"><CountUp to={pts} />{" "}{t("common.pts")}</p>
          <p className="muted nomargin">{parts.join(" · ")}</p>
          {attached && profile && profile.level ? (
            <div className="lvl"><span className="lvl-n">{t("score.level", { level: profile.level })}</span>
              <span className="lvl-bar"><span className="lvl-fill" style={{ "--lvl": lvlFill + "%" } as React.CSSProperties} /></span>
              <span className="sub">{t("score.ptsToLevel", { n: profile.next_level_at - profile.points, level: profile.level + 1 })}</span></div>
          ) : !attached ? (
            <p className="haul-wait">{t("score.moreWhenYouAddThis", { receipt: QPTS.receipt })}</p>
          ) : null}
        </div>
      )}
      <ScoreRow sess={sess} attached={attached} />
      <div className="group">
        <Row name={t("score.itemsFound")} right={`${p.done}/${p.total}`} />
        {dur != null && <Row name={t("score.time")} sub={receipt ? t("score.startToReceipt") : t("score.startToFinish")} right={durText(dur)} />}
        {receipt && <Row name={t("common.receipt")}
          sub={t("score.receiptSub", { merchant: receipt.merchant, count: receipt.items }) + (receipt.returns_total ? t("score.returnsNetted", { amount: m(receipt.returns_total) }) : "")}
          right={m(receipt.total)} />}
        {receipt && !receipt.totals_reconcile && <p className="muted">{t("score.theTotalDidNotReconcile")}</p>}
      </div>
      {attached && !plain && (
        <p><button id="score-challenge" className="btn secondary wide" type="button"
          onClick={() => nav.show("race", { store: sess.store })}>{t("score.challengeAFriendToBeat")}</button></p>
      )}
      <p className="closenote">{t(plain ? "score.tripClosed" : "score.huntClosed")}</p>
      {!attached && (
        <>
          <p className="muted">{t("score.noReceiptYetAddThis")}</p>
          <p><button id="score-addreceipt" className="btn wide" type="button" onClick={() => setAr(true)}>{t("score.addTheReceipt")}</button></p>
        </>
      )}
      <HaulPhoto sess={sess} plain={plain} attached={attached} onShare={openShare} />
      {profile && !plain && (
        <>
          <h3 className="sect">{t("score.badges")}</h3>
          <div className="group">
            {profile.badges.map((b, i) => (
              <div key={b.id} className={"row" + (b.earned ? " badgepop" : "")} style={{ animationDelay: i * 90 + "ms" }}>
                <div className="grow"><span className="name">{b.name}</span>
                  <span className="sub">{b.criteria} · {b.detail}</span></div>
                {b.earned
                  ? <><span className="money" style={{ color: "var(--accent-text)" }}>{t("common.earned")}</span>{!seen.has(b.id) && <span className="newpill">{t("score.new")}</span>}</>
                  : <span className="sub">{t("score.locked")}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {attached && wildNames.length > 0 && (
        <>
          <h3 className="sect">{t("score.wildFinds")}</h3>
          <div className="group"><div className="row">
            {wildNames.map(n => plain ? null : <img key={n} className="rowface" src={asset("assets/characters/" + faceFor(n))} alt="" />)}
            <div className="grow"><span className="name">{wildNames.join(", ")}</span>
              <span className="sub">{t("score.notOnTheListGrabbed")}</span></div>
          </div></div>
        </>
      )}
      <AddReceiptSheet target={ar ? { sessionId: sess.id, label: sess.store } : null} goesToHaul onClose={() => setAr(false)}
        onDone={s => { setAr(false); if (s) Object.assign(sess, s); afterFinish(nav, sess); }} />
      <ShareSheet req={share} onClose={() => setShare(null)} />
    </div>
  );
}
