import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Row, Empty } from "../ui/kit";
import { get } from "../lib/api";
import { asset } from "../lib/format";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-quest-progress and the quest half of
 * app.js renderProfile. Back lands on Profile. The Shell already
 * renders <section id="view-quest-progress">; no second one. */

const BADGE_ART: Record<string, string> = {
  top_contributor: "blueberry.webp", egg_baron: "egg.webp",
  banana_republic: "banana.webp", speed_demon: "pizza.webp",
  clean_sweep: "basket.webp", first_mapper: "compass.webp",
  eagle_eye: "binoculars.webp", receipt_keeper: "pantry.webp",
};

type Badge = { id: string; name: string; criteria: string; detail?: string; earned?: boolean };
type QProfile = {
  level?: number; points?: number; badges?: Badge[]; mapped_stores?: string[];
  stats: { hunts: number; receipts: number; streak_weeks: number; spots_reported?: number };
};
type Archive = { receipts: unknown[]; unsettled?: unknown[] };

export function QuestProgress() {
  const { t } = useTranslation();
  const nav = useNav();
  const { showErr } = useToast();
  const [profile, setProfile] = useState<QProfile | null>(null);
  const [unsettled, setUnsettled] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const [p, a] = await Promise.all([
        get<QProfile>("/api/quest/profile").catch(() => null),
        get<Archive>("/api/quest/receipts").catch(() => ({ receipts: [] } as Archive)),
      ]);
      if (!live) return;
      setProfile(p);
      setUnsettled((a.unsettled || []).length);
      if (p) {
        try {
          localStorage.setItem("arya-seen-badges",
            JSON.stringify((p.badges || []).filter(b => b.earned).map(b => b.id)));
        } catch { /* storage unavailable */ }
      }
    })().catch(showErr);
    return () => { live = false; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = profile?.stats;
  const badges = profile?.badges || [];
  const stores = profile?.mapped_stores || [];
  const eagle = badges.find(b => b.id === "eagle_eye");
  const active = !!(s && (s.hunts || s.receipts || unsettled));
  const showSpots = !!(s && (s.spots_reported || (eagle && eagle.earned)));

  return (
    <>
      <p><a href="#" id="pfq-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.questProgress")}</h2>
      <div id="pf-stats" className="stattiles" hidden={!active}>
        {profile && s && (
          <>
            <div className="stattile"><div className="sv">{s.hunts + unsettled}</div><div className="sl">{t("questProgress.huntsFinished")}</div></div>
            <div className="stattile"><div className="sv">{s.hunts}</div><div className="sl">{t("questProgress.receiptAttached")}</div></div>
            <div className="stattile"><div className="sv">{profile.level || 1}</div><div className="sl">{t("questProgress.levelPts", { points: profile.points || 0 })}</div></div>
            <div className="stattile"><div className="sv">{s.receipts}</div><div className="sl">{t("common.receipts")}</div></div>
            <div className="stattile"><div className="sv">{t("questProgress.wk", { count: s.streak_weeks })}</div><div className="sl">{t("questProgress.streak")}</div></div>
          </>
        )}
      </div>
      <p className="muted small">{t("questProgress.pointsLevelsAndSomeBadges")}</p>
      <div id="pf-spots" className="group" hidden={!showSpots}>
        {profile && s && (
          <>
            <Row name={t("questProgress.storeChangesYouSpotted")} sub={t("questProgress.pointsLandOnlyWhenA")} right={String(s.spots_reported || 0)} />
            {eagle && <Row name={t("questProgress.eagleEye")} sub={eagle.detail || eagle.criteria} right={eagle.earned ? t("questProgress.earnedTick") : t("score.locked")} />}
          </>
        )}
      </div>
      <h3 className="sect">{t("questProgress.badgeShelf")}</h3>
      <div id="pf-badges" className="badgetiles">
        {badges.map(b => (
          <div key={b.id} className={"badgetile" + (b.earned ? "" : " locked")}>
            {BADGE_ART[b.id] ? <img className="bdgimg" src={asset("assets/characters/" + BADGE_ART[b.id])} alt="" /> : null}
            <h4>{b.name}</h4><p>{b.criteria}</p>
            <span className="b-state">{b.earned ? t("questProgress.earnedTick") : t("questProgress.lockedDetail", { detail: b.detail || "" })}</span>
          </div>
        ))}
      </div>
      <h3 className="sect">{t("questProgress.mappedByYou")}</h3>
      <div id="pf-stores" className="group">
        {profile && (stores.length
          ? stores.map(st => <Row key={st} name={st} sub={t("questProgress.mappedByYou")} right="✓" />)
          : <Empty>{t("questProgress.noStoresMappedYetMapping")}</Empty>)}
      </div>
    </>
  );
}
