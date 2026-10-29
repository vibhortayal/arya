import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get } from "../lib/api";
import type { Currency } from "../lib/format";

export type AuthStatus = { has_users: boolean; registration_open: boolean; email_signin?: boolean };
type Session = {
  ready: boolean;
  user: string | null;
  demo: boolean;
  status: AuthStatus;
  currency: Currency;
  enter: (user: string, demo: boolean) => void;
  setCurrency: (c: Currency) => void;
  /* After sign out or account delete: back to the Login screen
   * (the old app reloaded the page). Re-reads /auth/status, since
   * deleting the last account opens first-run setup. */
  leave: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

/* Module-level state that belongs to one account (the Ask log, a
 * held plan draft) registers here and is cleared on sign out, so the
 * next account never sees it (the old app reloaded the page). */
const onLeave = new Set<() => void>();
export function clearOnSignOut(fn: () => void): void { onLeave.add(fn); }
function runLeaveHooks() { onLeave.forEach(fn => { try { fn(); } catch { /* keep going */ } }); }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<AuthStatus>({ has_users: true, registration_open: false });
  const [currency, setCurrency] = useState<Currency>({ code: "USD", symbol: "$" });

  useEffect(() => {
    (async () => {
      const st = await get<AuthStatus>("/auth/status").catch(() => ({ has_users: true, registration_open: false }));
      setStatus(st);
      const me = await fetch("/auth/me").then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (me && me.user) { setUser(me.user); setDemo(!!me.demo); }
      setReady(true);
    })();
  }, []);

  // The account's currency (Profile > Account): display only, amounts
  // are never converted. USD until the settings load.
  useEffect(() => {
    if (!user) return;
    get<{ currency: string; symbol: string }>("/api/settings")
      .then(s => setCurrency({ code: s.currency, symbol: s.symbol })).catch(() => {});
  }, [user]);

  const enter = useCallback((u: string, d: boolean) => { setUser(u); setDemo(d); (window as any).__aryaUser = u; }, []);

  const leave = useCallback(async () => {
    runLeaveHooks();
    const st = await get<AuthStatus>("/auth/status").catch(() => null);
    if (st) setStatus(st);
    setUser(null); setDemo(false); setCurrency({ code: "USD", symbol: "$" });
    (window as any).__aryaUser = undefined;
  }, []);

  return <Ctx.Provider value={{ ready, user, demo, status, currency, enter, setCurrency, leave }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
