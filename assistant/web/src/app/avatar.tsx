import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get } from "../lib/api";
import { asset } from "../lib/format";

/* One avatar for the whole app (app.js AV, loadAvatar, avatarSrc,
 * paintAvatar): the floating avatar in the Shell and the Profile card
 * read the same state, so a change in Profile repaints both. Mounted
 * per signed-in user, so signing out drops it. */

export type Av = { file?: string | null; image?: boolean; version?: number };
type AvatarCtx = {
  av: Av;
  /* null until the first load lands (the img stays hidden). */
  src: string | null;
  reload: () => Promise<void>;
  set: (patch: Partial<Av>) => void;
  /* The ring around the floating avatar fills toward the next level
   * (app.js paintLevelChip): pct 0..100 and the level for its label. */
  ring: { pct: number; level: number } | null;
  setRing: (r: { pct: number; level: number }) => void;
};

export const avatarSrc = (av: Av) =>
  av.image ? `/api/quest/avatar/image?v=${av.version}` : asset(`assets/characters/${av.file || "basket.webp"}`);

const Ctx = createContext<AvatarCtx | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const [av, setAv] = useState<Av>({ file: null, image: false, version: 0 });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    let a: Av;
    try { a = await get<Av>("/api/quest/avatar"); } catch { return; }
    setAv(a); setLoaded(true);
    try { localStorage.setItem("arya-avatar", a.file || "basket.webp"); } catch { /* private window */ }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const set = useCallback((patch: Partial<Av>) => { setAv(a => ({ ...a, ...patch })); setLoaded(true); }, []);
  const [ring, setRing] = useState<{ pct: number; level: number } | null>(null);
  const value = useMemo(() => ({ av, src: loaded ? avatarSrc(av) : null, reload, set, ring, setRing }), [av, loaded, reload, set, ring]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAvatar(): AvatarCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAvatar outside AvatarProvider");
  return c;
}
