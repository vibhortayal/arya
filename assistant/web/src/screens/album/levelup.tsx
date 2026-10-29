import { createRoot, type Root } from "react-dom/client";
import { Sheet } from "../../ui/Sheet";
import { useTranslation } from "../../i18n";

/* Port of albumLevelHtml / albumLevelSeen / albumMaybeLevelUp /
 * albumShowLevel in pwa/album.js: the level-up card with the unlock
 * ladder. First run (nothing recorded) records the level and shows
 * nothing. Later, a higher level shows the card once and records it. */

const ALB_LEVEL_KEY = "arya-album-level";
const mem: { level: number | null } = { level: null };

type Rung = { level: number; title: string; live?: boolean; reached?: boolean };
type Profile = { level?: number; unlocks?: { ladder?: Rung[]; never_locked?: string[]; open_to_all?: string[] } };

function levelSeen(): number | null {
  try {
    const v = localStorage.getItem(ALB_LEVEL_KEY);
    if (v !== null && v !== "" && !isNaN(Number(v))) return Number(v);
    return mem.level;
  } catch { return mem.level; }
}
function levelSave(level: number) {
  mem.level = level;
  try { localStorage.setItem(ALB_LEVEL_KEY, String(level)); } catch { /* memory keeps it */ }
}

function LevelCard({ profile, prev, onClose }: { profile: Profile; prev: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const level = Number(profile.level) || 1;
  const u = profile.unlocks || {};
  const ladder = u.ladder || [];
  const from = prev == null ? level - 1 : prev;
  const gained = ladder.filter(r => r.level > from && r.level <= level);
  const next = ladder.find(r => r.level > level) || null;
  const row = (r: Rung) => (
    <div className={"ladderrow" + (r.reached === false ? " ahead" : "")} key={r.level}><b>L{r.level}</b><span className="ladderttl">{r.title}</span>
      {r.live ? <span className="ladderchip live">{t("album.live")}</span> : <span className="ladderchip">{t("album.comingSoon")}</span>}</div>
  );
  const never = (u.never_locked || []).join(", ");
  const open = (u.open_to_all || []).join(", ");
  return (
    <div className="levelcard">
      <p className="levelkick">{t("album.levelUp")}</p>
      <div className="levelnum">{level}</div>
      <p className="levelsub">{t("album.youReachedLevel", { level })}</p>
      {gained.length
        ? <><h4 className="levelhead">{t("album.newAtThisLevel")}</h4><div className="ladder">{gained.map(row)}</div></>
        : <p className="levelsub">{t("album.keepHuntingYourNextRung")}</p>}
      {next && <><h4 className="levelhead">{t("album.next")}</h4><div className="ladder">{row({ ...next, reached: false })}</div></>}
      {open && <p className="levelnever">{t("album.openToEveryone", { open })}</p>}
      {never && <p className="levelnever">{t("album.neverLockedByLevel", { never })}</p>}
      <button type="button" className="btn primary wide" data-alb-close data-first onClick={onClose}>{t("album.keepGoing")}</button>
    </div>
  );
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
function close() {
  root?.unmount(); host?.remove();
  root = null; host = null;
}
function showLevel(profile: Profile, prev: number | null) {
  close();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <Sheet open onClose={close} id="alb-level">
      <LevelCard profile={profile} prev={prev} onClose={close} />
    </Sheet>,
  );
}

/* AlbumUI.maybeLevelUp: true when the card was shown. */
export function maybeLevelUp(profile: Profile | null | undefined): boolean {
  const lv = Number(profile && profile.level);
  if (!profile || !lv) return false;
  const seen = levelSeen();
  if (seen === null) { levelSave(lv); return false; }
  if (lv <= seen) return false;
  levelSave(lv);
  showLevel(profile, seen);
  return true;
}
