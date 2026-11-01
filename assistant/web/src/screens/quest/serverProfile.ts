import { get, put } from "../../lib/api";
import { emptyProfile, type Profile } from "../../game/core/meta";
import { localProfileStore, type ProfileStore } from "../../game/store";

/* The Quest game's profile on the server (usability audit, owner-approved
 * 2026-10-29): one level, one streak and one sticker album everywhere.
 * - The server keeps the game's own profile; its xp counts toward the
 *   account's points, and its weeks join the receipt weeks.
 * - The game shows the whole account: xp plus base_points (receipt-closed
 *   hunts) and every played week. What it saves back is its own part.
 * - The phone keeps a copy (offline, and first-run flags stay local).
 *   A phone that played before this has its profile carried up once. */
export type GameDoc = { profile: Profile | null; base_points: number; weeks: string[] };

export async function loadGameDoc(): Promise<GameDoc | null> {
  return get<GameDoc>("/api/quest/game").catch(() => null);
}

export function serverProfileStore(key: string, doc: GameDoc | null): ProfileStore {
  const local = localProfileStore(key);
  if (!doc) return local; // offline or signed out: the phone's copy
  const base = Math.max(0, doc.base_points || 0);
  let own: Profile = { ...emptyProfile(), ...(doc.profile || local.load()) };
  const send = (p: Profile) => { void put("/api/quest/game", { profile: p }).catch(() => {}); };
  if (!doc.profile && own.trips > 0) send(own);
  return {
    load: () => ({ ...own, xp: own.xp + base, weeks: [...new Set([...own.weeks, ...doc.weeks])].sort() }),
    save: p => {
      own = { ...p, xp: Math.max(0, p.xp - base) };
      // The kept doc (QuestMode's return-visit copy) follows the save.
      doc.profile = own;
      local.save(own);
      send(own);
    },
    flag: local.flag,
    setFlag: local.setFlag,
    reset: local.reset,
  };
}
