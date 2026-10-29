import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Row, Empty } from "../ui/kit";
import { get } from "../lib/api";
import { asset } from "../lib/format";

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
      <p><a href="#" id="pfq-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Quest progress</h2>
      <div id="pf-stats" className="stattiles" hidden={!active}>
        {profile && s && (
          <>
            <div className="stattile"><div className="sv">{s.hunts + unsettled}</div><div className="sl">Hunts finished</div></div>
            <div className="stattile"><div className="sv">{s.hunts}</div><div className="sl">Receipt attached</div></div>
            <div className="stattile"><div className="sv">{profile.level || 1}</div><div className="sl">Level · {profile.points || 0} pts</div></div>
            <div className="stattile"><div className="sv">{s.receipts}</div><div className="sl">Receipts</div></div>
            <div className="stattile"><div className="sv">{s.streak_weeks} wk{s.streak_weeks === 1 ? "" : "s"}</div><div className="sl">Streak</div></div>
          </>
        )}
      </div>
      <p className="muted small">Points, levels and some badges count hunts that have their receipt attached.</p>
      <div id="pf-spots" className="group" hidden={!showSpots}>
        {profile && s && (
          <>
            <Row name="Store changes you spotted" sub="Points land only when a change is verified" right={String(s.spots_reported || 0)} />
            {eagle && <Row name="Eagle Eye" sub={eagle.detail || eagle.criteria} right={eagle.earned ? "Earned ✓" : "Locked"} />}
          </>
        )}
      </div>
      <h3 className="sect">Badge shelf</h3>
      <div id="pf-badges" className="badgetiles">
        {badges.map(b => (
          <div key={b.id} className={"badgetile" + (b.earned ? "" : " locked")}>
            {BADGE_ART[b.id] ? <img className="bdgimg" src={asset("assets/characters/" + BADGE_ART[b.id])} alt="" /> : null}
            <h4>{b.name}</h4><p>{b.criteria}</p>
            <span className="b-state">{b.earned ? "Earned ✓" : `Locked · ${b.detail || ""}`}</span>
          </div>
        ))}
      </div>
      <h3 className="sect">Mapped by you</h3>
      <div id="pf-stores" className="group">
        {profile && (stores.length
          ? stores.map(st => <Row key={st} name={st} sub="Mapped by you" right="✓" />)
          : <Empty>No stores mapped yet. Mapping a store is how its 3D view gets built.</Empty>)}
      </div>
    </>
  );
}
