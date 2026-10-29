/* Where the profile lives between trips. The game takes this as a
 * prop: the lab keeps it on the device, the app can keep it on the
 * server. Flags are first-run marks (tutorial seen and the like). */
import { emptyProfile, type Profile } from "./core/meta";

export interface ProfileStore {
  load(): Profile;
  save(p: Profile): void;
  flag(name: string): boolean;
  setFlag(name: string): void;
  reset?(): void;
}

export function localProfileStore(key: string): ProfileStore {
  const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
  const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: play on */ } };
  return {
    load: () => read(key, emptyProfile()),
    save: p => write(key, p),
    flag: n => !!read<Record<string, boolean>>(key + ":flags", {})[n],
    setFlag: n => write(key + ":flags", { ...read<Record<string, boolean>>(key + ":flags", {}), [n]: true }),
    reset: () => { try { localStorage.removeItem(key); localStorage.removeItem(key + ":flags"); } catch { /* */ } },
  };
}
