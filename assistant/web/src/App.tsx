import { useEffect, useRef, type ComponentType } from "react";
import { AvatarProvider, useAvatar } from "./app/avatar";
import { NavProvider, useNav } from "./app/nav";
import { SessionProvider, useSession } from "./app/session";
import { useGroupLive } from "./app/groupLive";
import { TABS, type ViewId } from "./app/views";
import { ToastProvider, useToast } from "./ui/Toast";
import { get } from "./lib/api";
import { joinCodeFromUrl } from "./screens/GroupJoin";
import { TabAsk, TabLists, TabQuest, TabSettings, TabToday } from "./ui/icons";
import { Login } from "./screens/Login";
import { SCREENS } from "./screens/registry";

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
  return <AvatarProvider><NavProvider initial="home"><Shell /></NavProvider></AvatarProvider>;
}

const TAB_ICON: Record<string, ComponentType> = { home: TabToday, list: TabLists, chat: TabAsk, community: TabQuest, profile: TabSettings };
const TAB_LABEL: Record<string, string> = { home: "Today", list: "Lists", chat: "Ask", community: "Quest", profile: "Settings" };

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
      if (g.group) { toast(`You are already in ${g.group.name}. Leave it first to join another group.`); return; }
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
  const Screen = SCREENS[nav.view];
  const { src: avatar, ring } = useAvatar();
  useInviteLink();
  useListFromHash();
  useGroupLive();
  return (
    <>
      {nav.chrome && (
        <button id="avatar-btn" className="avatar floating" type="button"
          aria-label={ring ? `Settings, level ${ring.level}` : "Settings"}
          style={ring ? ({ "--pct": ring.pct + "%" } as React.CSSProperties) : undefined}
          onClick={() => nav.view !== "profile" && nav.show("profile", { from: TABS.includes(nav.view) ? nav.view : "home" })}>
          <span id="avatar-initial">{(s.demo ? "demo" : s.user || "A").charAt(0).toUpperCase()}</span>
          <img id="avatar-img" alt="" hidden={!avatar} src={avatar || undefined} />
        </button>
      )}
      {nav.chrome && s.demo && <p id="demobar" className="note">Demo household · resets when you leave</p>}
      <main id="app-main">
        <section id={"view-" + nav.view} className="view" key={nav.key}>
          <Screen />
        </section>
      </main>
      {nav.chrome && (
        <nav id="tabs">
          {TABS.map((t: ViewId) => {
            const Icon = TAB_ICON[t];
            return (
              <button key={t} type="button" data-view={"view-" + t} className={nav.view === t ? "active" : undefined}
                onClick={() => nav.show(t)}>
                <Icon /><span>{TAB_LABEL[t]}</span>
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}
