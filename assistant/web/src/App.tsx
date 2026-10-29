import { useEffect, useState, type ComponentType } from "react";
import { get } from "./lib/api";
import { asset } from "./lib/format";
import { NavProvider, useNav } from "./app/nav";
import { SessionProvider, useSession } from "./app/session";
import { TABS, type ViewId } from "./app/views";
import { ToastProvider } from "./ui/Toast";
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
  return <NavProvider initial="home"><Shell /></NavProvider>;
}

const TAB_ICON: Record<string, ComponentType> = { home: TabToday, list: TabLists, chat: TabAsk, community: TabQuest, profile: TabSettings };
const TAB_LABEL: Record<string, string> = { home: "Today", list: "Lists", chat: "Ask", community: "Quest", profile: "Settings" };

/* pwa/index.html's shell: the floating avatar (the way to Profile),
 * the demo bar, one view at a time, and the four-tab bar. */
function Shell() {
  const nav = useNav();
  const s = useSession();
  const Screen = SCREENS[nav.view];
  const avatar = useAvatar();
  return (
    <>
      {nav.chrome && (
        <button id="avatar-btn" className="avatar floating" type="button" aria-label="Profile"
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

/* The player's avatar (app.js loadAvatar/avatarSrc): a cast
 * character or a made picture. The level ring (--pct) is painted by
 * Today in the old app and comes with the Today port. */
function useAvatar(): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    get<{ file?: string; image?: boolean; version?: number }>("/api/quest/avatar")
      .then(av => setSrc(av.image ? `/api/quest/avatar/image?v=${av.version}` : asset(`assets/characters/${av.file || "basket.webp"}`)))
      .catch(() => {});
  }, []);
  return src;
}
