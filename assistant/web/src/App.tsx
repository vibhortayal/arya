import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { AvatarProvider } from "./app/avatar";
import { NavProvider, useBackHandler, useNav } from "./app/nav";
import { SessionProvider, useSession } from "./app/session";
import { TourProvider, useTour } from "./ui/Tour";
import { GuideProvider } from "./ui/Guide";
import { useTourSteps } from "./onboarding/demoTour";
import { useGroupLive } from "./app/groupLive";
import { PARENT_TAB, TABS, type ViewId } from "./app/views";
import { ToastProvider, useToast } from "./ui/Toast";
import { get } from "./lib/api";
import { startQueue } from "./lib/scanQueue";
import { isOffline, subscribeOffline } from "./lib/offline";
import { useTown } from "./lib/town";
import { isDevelopersPath, joinCodeFromUrl } from "./lib/paths";
import { TabAsk, TabHelp, TabLists, TabQuest, TabSettings, TabToday } from "./ui/icons";
import { Login } from "./screens/Login";
// The public developer page and Join a group load only when opened (#17).
const Developers = lazy(() => import("./screens/Developers").then(m => ({ default: m.Developers })));
import { SCREENS, preloadTabScreens } from "./screens/registry";
import { openGuide } from "./ui/Guide";
import { WelcomeSheet, showWelcome, demoWelcomePending, clearDemoWelcome } from "./ui/FirstRun";
import { EndOfDemo, openEndOfDemo } from "./ui/EndOfDemo";
import { ErrorBoundary, ScreenSkeleton } from "./ui/ErrorBoundary";
import { t } from "./i18n";

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </ToastProvider>
  );
}

function Root() {
  const s = useSession();
  // index.html's start shell held the page until now; Login or the app
  // takes over in the same frame.
  useLayoutEffect(() => { if (s.ready) document.getElementById("boot")?.remove(); }, [s.ready]);
  /* The public developer page needs no account, so it comes first. */
  if (isDevelopersPath(location.pathname)) return <Suspense fallback={null}><Developers /></Suspense>;
  if (!s.ready) return null;
  if (!s.user) return <Login />;
  return <AvatarProvider><NavProvider initial="home"><TourProvider><GuideProvider><Shell /></GuideProvider></TourProvider></NavProvider></AvatarProvider>;
}

const TAB_ICON: Record<string, ComponentType> = { home: TabToday, list: TabLists, chat: TabAsk, community: TabQuest, help: TabHelp, profile: TabSettings };
/* Tab names are en.json keys. */
const TAB_LABEL: Record<string, string> = { home: "tabs.today", list: "tabs.lists", chat: "tabs.ask", community: "tabs.quest", help: "tabs.help", profile: "tabs.settings" };

/* An invite link (/?join=CODE) opens Join a group once the app knows
 * who is signed in (group.js afterSignIn; the demo skips it). */
function useInviteLink() {
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || demo) return;
    done.current = true;
    const code = joinCodeFromUrl();
    if (!code) return;
    (async () => {
      let g: { enabled?: boolean; group?: { name: string } | null };
      try { g = await get("/api/group"); } catch { g = { enabled: false, group: null }; }
      try { history.replaceState(null, "", location.pathname); } catch { /* stays in the bar */ }
      if (!g.enabled) return;
      if (g.group) { toast(t("groupJoin.alreadyIn", { name: g.group.name })); return; }
      nav.show("group-join", { code });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/* A tapped push reminder opens the app at /#list (sw.js
 * notificationclick; push.js openFromHash): show the Lists tab and
 * take the fragment out of the bar. */
function useListFromHash() {
  const nav = useNav();
  useEffect(() => {
    const open = () => {
      if (location.hash !== "#list") return;
      nav.show("list");
      try { history.replaceState(null, "", location.pathname + location.search); } catch { /* stays in the bar */ }
    };
    open();
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/* Map my store walks wait on the phone and go up when there is signal
 * (lib/scanQueue). While a walk is being read, ask now and then; when
 * one is ready, say so once, wherever the shopper is. */
function useScanQueue() {
  const { toast } = useToast();
  const s = useSession();
  useEffect(() => {
    if (!s.user) return;
    startQueue();
    let watching = new Set<string>();
    const told = new Set<string>();
    const check = async () => {
      try {
        const r = await get<{ jobs: { id: string; store: string; status: string; seen: boolean }[] }>("/api/storemap/jobs");
        const jobs = r.jobs || [];
        for (const j of jobs) {
          if (watching.has(j.id) && j.status === "ready" && !j.seen && !told.has(j.id)) {
            told.add(j.id);
            toast(t("mapScan.readyToast", { store: j.store.split("|")[0] }));
          }
        }
        watching = new Set(jobs.filter(j => j.status === "queued" || j.status === "reading").map(j => j.id));
      } catch { /* try again next time */ }
    };
    const sent = () => { void check(); };
    window.addEventListener("arya-scan-sent", sent);
    const id = window.setInterval(() => { if (watching.size) void check(); }, 10000);
    void check();
    return () => { window.removeEventListener("arya-scan-sent", sent); clearInterval(id); };
  }, [s.user]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* pwa/index.html's shell: the demo bar, one view at a time, and the
 * tab bar. No floating avatar (usability pass, owner 2026-10-29): it
 * did what the Settings tab does and covered page titles; the avatar
 * lives on Settings and in Quest. */
function Shell() {
  const nav = useNav();
  const s = useSession();
  const town = useTown();
  const Screen = SCREENS[nav.view];
  const tour = useTour();
  const tourSteps = useTourSteps();
  const [, answered] = useState(0);
  const answerWelcome = () => { if (s.demo) { clearDemoWelcome(); answered(n => n + 1); } else s.markOnboarded(); };
  useInviteLink();
  const offline = useSyncExternalStore(subscribeOffline, isOffline);
  // Back from the demo's first screen returns to the start page, as
  // "Leave the demo" does, instead of leaving the site (pilot audit, 2026-10-30).
  useBackHandler(() => {
    if (!s.demo || nav.depth > 1 || !nav.chrome) return false;
    fetch("/auth/logout", { method: "POST" }).catch(() => {}).finally(() => { s.leave(); });
    return true;
  });
  useListFromHash();
  useGroupLive();
  useScanQueue();
  useEffect(() => {
    // After first paint and a quiet moment, fetch the other tabs' code.
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(preloadTabScreens, { timeout: 8000 }) : window.setTimeout(preloadTabScreens, 3000);
    return () => { if (!idle) clearTimeout(id); };
  }, []);
  return (
    <>
      {nav.chrome && s.demo && <p id="demobar" className="note">{town ? t("town.demoBar") : t("common.demoBar")}{" "}
        <button id="demo-finish" className="linkbtn" type="button" onClick={openEndOfDemo}>{t("endDemo.finish")}</button></p>}
      {nav.chrome && offline && <p id="offlinebar" role="status" className="note">{t("offline.bar")}</p>}
      {s.demo && <EndOfDemo />}
      <main id="app-main">
        <section id={"view-" + nav.view} className="view" key={nav.key}>
          <ErrorBoundary key={nav.view}><Suspense fallback={<ScreenSkeleton />}><Screen /></Suspense></ErrorBoundary>
        </section>
      </main>
      {nav.chrome && (
        <nav id="tabs" aria-label={t("tabs.label")}>
          {TABS.map((v: ViewId) => {
            const Icon = TAB_ICON[v];
            const lit = nav.view === v || PARENT_TAB[nav.view] === v;
            return (
              <button key={v} type="button" data-view={"view-" + v} className={lit ? "active" : undefined} aria-current={lit ? "page" : undefined}
                onClick={() => nav.tab(v)}>
                <Icon /><span>{t(TAB_LABEL[v])}</span>
              </button>
            );
          })}
        </nav>
      )}
      {showWelcome(s.user, s.demo, s.onboarded, demoWelcomePending()) && (
        <WelcomeSheet onTour={() => { answerWelcome(); tour.startTour(tourSteps, s.demo ? { onDone: () => openGuide() } : undefined); }} onSkip={answerWelcome} demo={s.demo} />
      )}
    </>
  );
}
