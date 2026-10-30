import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post } from "../lib/api";
import type { Currency } from "../lib/format";
import { DEFAULT_LANGUAGES, type Language } from "../lib/language";
import { applyLanguage } from "../i18n";

export type AuthStatus = { has_users: boolean; registration_open: boolean; email_signin?: boolean };
type Session = {
  ready: boolean;
  user: string | null;
  demo: boolean;
  status: AuthStatus;
  currency: Currency;
  enter: (user: string, demo: boolean) => void;
  setCurrency: (c: Currency) => void;
  /* Ask Arya's reply language: "auto" or a code from `languages`. */
  language: string;
  languages: Language[];
  setLanguage: (code: string) => void;
  /* First run (#153): false only for an account that has not answered
   * the welcome sheet and holds no data; null until settings load. */
  onboarded: boolean | null;
  /* Either welcome choice: saved per account on the server. */
  markOnboarded: () => void;
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
  const [language, setLanguage] = useState("auto");
  const [languages, setLanguages] = useState<Language[]>(DEFAULT_LANGUAGES);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

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
  // are never converted. USD until the settings load. The Language
  // setting comes with it (Auto until then).
  useEffect(() => {
    if (!user) return;
    get<{ currency: string; symbol: string; language?: string; languages?: Language[]; onboarded?: boolean }>("/api/settings")
      .then(s => {
        setCurrency({ code: s.currency, symbol: s.symbol });
        setOnboarded(s.onboarded !== false);
        if (s.language) setLanguage(s.language);
        if (s.languages?.length) setLanguages(s.languages);
      }).catch(() => {});
  }, [user]);

  // The UI language follows the same setting. Only English has
  // strings yet, so every choice reads English (the fallback).
  useEffect(() => { applyLanguage(language); }, [language]);

  const markOnboarded = useCallback(() => {
    setOnboarded(true);
    post("/api/settings", { onboarded: true }).catch(() => {});
  }, []);

  const enter = useCallback((u: string, d: boolean) => { setUser(u); setDemo(d); (window as any).__aryaUser = u; }, []);

  const leave = useCallback(async () => {
    runLeaveHooks();
    const st = await get<AuthStatus>("/auth/status").catch(() => null);
    if (st) setStatus(st);
    setUser(null); setDemo(false); setCurrency({ code: "USD", symbol: "$" }); setLanguage("auto"); setOnboarded(null);
    (window as any).__aryaUser = undefined;
  }, []);

  return <Ctx.Provider value={{ ready, user, demo, status, currency, enter, setCurrency, language, languages, setLanguage, onboarded, markOnboarded, leave }}>{children}</Ctx.Provider>;
}

/* The session when there is one (the guide also renders in tests
 * without a SessionProvider). */
export function useSessionMaybe(): Session | null {
  return useContext(Ctx);
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
