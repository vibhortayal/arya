import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post } from "../lib/api";
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
  interface Window { __boot?: { status: Promise<AuthStatus>; me: Promise<{ user?: string | null; demo?: boolean } | null> } }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
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
      const st = await (boot?.status ?? get<AuthStatus>("/auth/status")).catch(() => ({ has_users: true, registration_open: false }));
      setStatus(st);
      // null: no answer (no signal, or the server is down), which is
      // not the same as "signed out" ({ user: null }).
      const me = await (boot?.me ?? fetch("/auth/me").then(r => (r.ok ? r.json() : null))).catch(() => null);
      if (me && me.user) { setUser(me.user); setDemo(!!me.demo); remember(me.user, !!me.demo); leaveTeamPath(); }
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
    get<{ currency: string; symbol: string; language?: string; languages?: Language[]; onboarded?: boolean; shop_mode?: ShopMode | null; quest_nudge?: boolean; display?: Display; layouts?: Layouts }>("/api/settings")
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

  const enter = useCallback((u: string, d: boolean) => { setUser(u); setDemo(d); (window as any).__aryaUser = u; remember(u, d); leaveTeamPath(); }, []);

  const leave = useCallback(async () => {
    runLeaveHooks();
    remember(null);
    const st = await get<AuthStatus>("/auth/status").catch(() => null);
    if (st) setStatus(st);
    setUser(null); setDemo(false); setCurrency({ code: "USD", symbol: "$" }); setLanguage("auto"); setOnboarded(null); setShopMode(null); setQuestNudge(false); setDisplay(DISPLAY_DEFAULT); setLayouts({});
    (window as any).__aryaUser = undefined;
  }, []);

  return <Ctx.Provider value={{ ready, user, demo, status, currency, enter, setCurrency, language, languages, setLanguage, onboarded, markOnboarded, shopMode, questNudge, saveShopMode, patchShop, display, saveDisplay, layouts, saveLayout, leave }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
