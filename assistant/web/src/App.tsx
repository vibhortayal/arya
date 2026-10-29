import { useEffect, useRef, type ComponentType } from "react";
import { AvatarProvider, useAvatar } from "./app/avatar";
import { NavProvider, useNav } from "./app/nav";
import { SessionProvider, useSession } from "./app/session";
import { TourProvider, useTour } from "./ui/Tour";
import { GuideProvider } from "./ui/Guide";
import { FIRST_RUN_TOUR } from "./onboarding/firstRunTour";
import { useGroupLive } from "./app/groupLive";
import { TABS, type ViewId } from "./app/views";
import { ToastProvider, useToast } from "./ui/Toast";
import { get } from "./lib/api";
import { useTown } from "./lib/town";
import { joinCodeFromUrl } from "./screens/GroupJoin";
import { TabAsk, TabLists, TabQuest, TabSettings, TabToday } from "./ui/icons";
import { Login } from "./screens/Login";
import { SCREENS } from "./screens/registry";
import { WelcomeSheet, showWelcome } from "./ui/FirstRun";
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
  if (!s.ready) return null;
  if (!s.user) return <Login />;
  return <AvatarProvider><NavProvider initial="home"><TourProvider><GuideProvider><Shell /></GuideProvider></TourProvider></NavProvider></AvatarProvider>;
}

const TAB_ICON: Record<string, ComponentType> = { home: TabToday, list: TabLists, chat: TabAsk, community: TabQuest, profile: TabSettings };
/* Tab names are en.json keys. */
const TAB_LABEL: Record<string, string> = { home: "tabs.today", list: "tabs.lists", chat: "tabs.ask", community: "tabs.quest", profile: "tabs.settings" };

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

/* pwa/index.html's shell: the floating avatar (the way to Profile),
 * the demo bar, one view at a time, and the four-tab bar. */
function Shell() {
  const nav = useNav();
  const s = useSession();
  const town = useTown();
  const Screen = SCREENS[nav.view];
  const { src: avatar, ring } = useAvatar();
  const tour = useTour();
  useInviteLink();
  useListFromHash();
  useGroupLive();
  return (
    <>
      {nav.chrome && (
        <button id="avatar-btn" className="avatar floating" type="button"
          aria-label={ring ? t("tabs.settingsLevel", { level: ring.level }) : t("tabs.settings")}
          style={ring ? ({ "--pct": ring.pct + "%" } as React.CSSProperties) : undefined}
          onClick={() => nav.view !== "profile" && nav.show("profile", { from: TABS.includes(nav.view) ? nav.view : "home" })}>
          <span id="avatar-initial">{(s.demo ? "demo" : s.user || "A").charAt(0).toUpperCase()}</span>
          <img id="avatar-img" alt="" hidden={!avatar} src={avatar || undefined} />
        </button>
      )}
      {nav.chrome && s.demo && <p id="demobar" className="note">{town ? t("town.demoBar") : t("common.demoBar")}</p>}
      <main id="app-main">
        <section id={"view-" + nav.view} className="view" key={nav.key}>
          <Screen />
        </section>
      </main>
      {nav.chrome && (
        <nav id="tabs">
          {TABS.map((v: ViewId) => {
            const Icon = TAB_ICON[v];
            return (
              <button key={v} type="button" data-view={"view-" + v} className={nav.view === v ? "active" : undefined}
                onClick={() => nav.show(v)}>
                <Icon /><span>{t(TAB_LABEL[v])}</span>
              </button>
            );
          })}
        </nav>
      )}
      {showWelcome(s.user, s.demo, s.onboarded) && (
        <WelcomeSheet onTour={() => { s.markOnboarded(); tour.startTour(FIRST_RUN_TOUR); }} onSkip={s.markOnboarded} />
      )}
    </>
  );
}
