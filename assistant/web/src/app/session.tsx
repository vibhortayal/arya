import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { get, post, forgetReads, keepBootRead, SESSION_ENDED } from "../lib/api";
import { toastGlobal } from "../ui/Toast";
import { t } from "../i18n";
import type { Currency } from "../lib/format";
import { DEFAULT_LANGUAGES, type Language } from "../lib/language";
import { applyLanguage } from "../i18n";

export type ShopMode = "quest" | "list" | "ask";
/* Settings > Display (card library, 2026-10-30). The server keeps it
 * per account (api/routes/account.py DISPLAY); applyDisplay sets it on
 * the page for every screen. */
export type Display = { text: number; spacing: "compact" | "comfortable"; bold: boolean; pictures: boolean; motion: boolean };
export const DISPLAY_DEFAULT: Display = { text: 1, spacing: "comfortable", bold: false, pictures: true, motion: true };
/* Text size steps: the styles are in px, so the page zooms, as a
 * phone's Display Zoom does. */
export const TEXT_ZOOM = [0.9, 1, 1.1, 1.2, 1.35];
/* Edit mode on other screens (card library): what each screen keeps,
 * as lists of ids or texts (api/routes/account.py LAYOUT_SCREENS). */
export type Layouts = {
  lists?: { order?: string[] | null; hidden?: string[] | null; flags?: string[] | null };
  ask?: { chips?: string[] | null };
  spending?: { on?: string[] | null };
  quest?: { order?: string[] | null; hidden?: string[] | null };
  /* The bottom bar's four places, in order (lib/bar.ts). */
  bar?: { on?: string[] | null };
};
export function applyDisplay(d: Display): void {
  const root = document.documentElement;
  const z = TEXT_ZOOM[d.text] ?? 1;
  root.style.zoom = z === 1 ? "" : String(z);
  root.classList.toggle("dense", d.spacing === "compact");
  root.classList.toggle("boldtext", d.bold);
  root.classList.toggle("nopics", !d.pictures);
  root.classList.toggle("nomotion", !d.motion);
}
export type AuthStatus = { has_users: boolean; registration_open: boolean; email_signin?: boolean; own_key_signup?: boolean };
type Session = {
  ready: boolean;
  user: string | null;
  demo: boolean;
  /* Owner rows in Settings (registration switch, waitlist): false
   * until /auth/me says otherwise, and offline. */
  admin: { owner: boolean; waitlist: boolean };
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
  /* What Start shopping does (8b): null until the person picks once. */
  shopMode: ShopMode | null;
  /* The Today "Try a Quest" card: only for Just my list, after a few trips. */
  questNudge: boolean;
  saveShopMode: (m: ShopMode) => Promise<void>;
  /* "list_trip" counts a finished list-only trip; the others answer the card. */
  patchShop: (body: { list_trip?: true; quest_nudge?: "snooze" | "off" }) => Promise<void>;
  display: Display;
  /* Changes some Display settings, shows them at once and saves them. */
  saveDisplay: (d: Partial<Display>) => Promise<void>;
  layouts: Layouts;
  /* Replaces one screen's layout, shows it at once and saves it. */
  saveLayout: <K extends keyof Layouts>(screen: K, v: Layouts[K]) => Promise<void>;
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
/* True from sign out until the next sign in: a read still on its way
 * when the person signs out gets a 401 that is not news (re-audit N1). */
let leaving = false;
function runLeaveHooks() { onLeave.forEach(fn => { try { fn(); } catch { /* keep going */ } }); }

/* The last signed-in account, so a reload with no signal can open the
 * app instead of the sign-in page. Only the name: the session cookie
 * stays the proof, and sign out removes it. */
const LAST_USER = "arya.lastUser";
function remember(user: string | null, demo = false): void {
  try {
    if (user) localStorage.setItem(LAST_USER, JSON.stringify({ user, demo }));
    else localStorage.removeItem(LAST_USER);
  } catch { /* private mode: no offline reopen */ }
}
function lastUser(): { user: string; demo: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_USER) || "null");
    return v && typeof v.user === "string" ? { user: v.user, demo: !!v.demo } : null;
  } catch { return null; }
}
/* /team only opens the password form: once signed in, the address bar
 * (and a bookmark or Home Screen icon made from it) reads / (audit M6). */
function leaveTeamPath(): void {
  if (/^\/team\/?$/.test(location.pathname)) history.replaceState(null, "", "/" + location.search + location.hash);
}

declare global {
  interface Window {
    __boot?: { status: Promise<AuthStatus>; me: Promise<{ user?: string | null; demo?: boolean; owner?: boolean; waitlist_admin?: boolean } | null> };
    /* Started by boot.js for a returning account; each is read once. */
    __bootData?: { settings?: Promise<any>; today?: Promise<any> };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [admin, setAdmin] = useState({ owner: false, waitlist: false });
  const [status, setStatus] = useState<AuthStatus>({ has_users: true, registration_open: false });
  const [currency, setCurrency] = useState<Currency>({ code: "USD", symbol: "$" });
  const [language, setLanguage] = useState("auto");
  const [languages, setLanguages] = useState<Language[]>(DEFAULT_LANGUAGES);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [shopMode, setShopMode] = useState<ShopMode | null>(null);
  const [questNudge, setQuestNudge] = useState(false);
  const [display, setDisplay] = useState<Display>(DISPLAY_DEFAULT);
  const [layouts, setLayouts] = useState<Layouts>({});
  useEffect(() => { applyDisplay(display); }, [display]);

  useEffect(() => {
    (async () => {
      // public/boot.js started both calls while the bundle downloaded.
      const boot = window.__boot;
      window.__boot = undefined;
      window.__bootData = { settings: (boot as any)?.settings, today: (boot as any)?.today };
      const st = await (boot?.status ?? get<AuthStatus>("/auth/status")).catch(() => ({ has_users: true, registration_open: false }));
      setStatus(st);
      // null: no answer (no signal, or the server is down), which is
      // not the same as "signed out" ({ user: null }).
      const me = await (boot?.me ?? fetch("/auth/me").then(r => (r.ok ? r.json() : null))).catch(() => null);
      if (me && me.user) { setUser(me.user); setDemo(!!me.demo); setAdmin({ owner: !!me.owner, waitlist: !!me.waitlist_admin }); remember(me.user, !!me.demo); leaveTeamPath(); }
      else if (me) remember(null);
      else {
        // A reload in a store with no signal opens the app as the last
        // account (audit H1, 2026-10-30), not the sign-in page. When the
        // signal is back, a session that ended meanwhile signs out.
        const last = lastUser();
        if (last) {
          setUser(last.user); setDemo(last.demo);
          addEventListener("online", () => {
            fetch("/auth/me").then(r => (r.ok ? r.json() : null)).then(m => {
              if (m && !m.user) { remember(null); setUser(null); setDemo(false); }
            }).catch(() => {});
          }, { once: true });
        }
      }
      setReady(true);
    })();
  }, []);

  // The account's currency (Profile > Account): display only, amounts
  // are never converted. USD until the settings load. The Language
  // setting comes with it (Auto until then).
  useEffect(() => {
    if (!user) return;
    type S = { currency: string; symbol: string; language?: string; languages?: Language[]; onboarded?: boolean; shop_mode?: ShopMode | null; quest_nudge?: boolean; display?: Display; layouts?: Layouts };
    const early = window.__bootData?.settings as Promise<S> | undefined;
    if (window.__bootData) window.__bootData.settings = undefined;
    (early ? early.then(v => { keepBootRead("/api/settings", v); return v; }, () => get<S>("/api/settings")) : get<S>("/api/settings"))
      .then(s => {
        setCurrency({ code: s.currency, symbol: s.symbol });
        setOnboarded(s.onboarded !== false);
        setShopMode(s.shop_mode ?? null);
        setQuestNudge(!!s.quest_nudge);
        if (s.display) setDisplay({ ...DISPLAY_DEFAULT, ...s.display });
        setLayouts(s.layouts || {});
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

  const applyShop = (r: { shop_mode?: ShopMode | null; quest_nudge?: boolean }) => {
    setShopMode(r.shop_mode ?? null);
    setQuestNudge(!!r.quest_nudge);
  };
  const saveShopMode = useCallback(async (m: ShopMode) => {
    setShopMode(m);
    applyShop(await post("/api/settings", { shop_mode: m }));
  }, []);
  const patchShop = useCallback(async (body: { list_trip?: true; quest_nudge?: "snooze" | "off" }) => {
    applyShop(await post("/api/settings", body));
  }, []);

  const saveDisplay = useCallback(async (d: Partial<Display>) => {
    setDisplay(x => ({ ...x, ...d }));
    const r = await post<{ display?: Display }>("/api/settings", { display: d });
    if (r.display) setDisplay({ ...DISPLAY_DEFAULT, ...r.display });
  }, []);

  const saveLayout = useCallback(async <K extends keyof Layouts>(screen: K, v: Layouts[K]) => {
    setLayouts(x => ({ ...x, [screen]: v }));
    const r = await post<{ layouts?: Layouts }>("/api/settings", { layouts: { [screen]: v } });
    if (r.layouts) setLayouts(r.layouts);
  }, []);

  const enter = useCallback((u: string, d: boolean) => { leaving = false; forgetReads(); setUser(u); setDemo(d); (window as any).__aryaUser = u; remember(u, d); leaveTeamPath(); }, []);

  const leave = useCallback(async () => {
    leaving = true;
    runLeaveHooks();
    forgetReads();
    remember(null);
    const st = await get<AuthStatus>("/auth/status").catch(() => null);
    if (st) setStatus(st);
    setUser(null); setDemo(false); setAdmin({ owner: false, waitlist: false }); setCurrency({ code: "USD", symbol: "$" }); setLanguage("auto"); setOnboarded(null); setShopMode(null); setQuestNudge(false); setDisplay(DISPLAY_DEFAULT); setLayouts({});
    (window as any).__aryaUser = undefined;
  }, []);

  // A 401 on a signed-in session (lib/api): the server forgot it, as a
  // deploy does to every demo session (re-audit N1). Back to the start
  // page with one plain sentence, not a screen of failed loads.
  const who = useRef({ user, demo }); who.current = { user, demo };
  useEffect(() => {
    let ending = false;
    const onEnd = () => {
      if (ending || leaving || !who.current.user) return;
      ending = true;
      const wasDemo = who.current.demo;
      leave().finally(() => {
        ending = false; leaving = false;
        toastGlobal(t(wasDemo ? "common.sessionEndedDemo" : "common.sessionEnded"));
      });
    };
    addEventListener(SESSION_ENDED, onEnd);
    return () => removeEventListener(SESSION_ENDED, onEnd);
  }, [leave]);

  // One object per change, not per render (speed audit #14): every
  // useSession() screen re-rendered whenever the provider did.
  const value = useMemo(() => ({ ready, user, demo, admin, status, currency, enter, setCurrency, language, languages, setLanguage, onboarded, markOnboarded, shopMode, questNudge, saveShopMode, patchShop, display, saveDisplay, layouts, saveLayout, leave }),
    [ready, user, demo, admin, status, currency, enter, language, languages, onboarded, markOnboarded, shopMode, questNudge, saveShopMode, patchShop, display, saveDisplay, layouts, saveLayout, leave]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* True in the demo; false for a real account or when there is no provider (tests, isolated screens). */
export function useIsDemo(): boolean { return !!useContext(Ctx)?.demo; }
/* The saved bottom bar (lib/bar.ts barOf cleans it); none outside a session. */
export function useSavedBar(): unknown { return useContext(Ctx)?.layouts?.bar?.on; }

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
