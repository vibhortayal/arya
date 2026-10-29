import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { useNav } from "../../app/nav";
import { useSession } from "../../app/session";
import { useAvatar } from "../../app/avatar";
import { localProfileStore } from "../../game/store";
import { AppSource } from "./appSource";
import { useTranslation } from "../../i18n";

/* The Quest tab: the 3D shopping game on the user's own lists, stores
 * and the shared store map (#158, owner 2026-10-29). The game and its
 * three.js world load lazily, so other tabs never pay for them.
 * - Home, store pick and album sit above the tab bar; a trip and its
 *   finish screen take the whole phone (no tabs, no avatar).
 * - After a real trip, "Add your receipt" opens the app's Finish
 *   screen on the trip's hunt session: receipts settle it as before.
 * - Older trips, Shop-Off, friends and the leaderboard live on the
 *   Trips page ("trips"), linked from the game's home. */
const QuestGame = lazy(() => import("../../game"));

const FULL = new Set(["play", "finish", "loading"]);

export function QuestMode() {
  const { t } = useTranslation();
  const nav = useNav();
  const avatar = useAvatar().src;
  const s = useSession();
  const source = useMemo(() => new AppSource(), []);
  const store = useMemo(() => localProfileStore(`arya-quest:${s.user || "guest"}`), [s.user]);
  const listId = typeof nav.params.listId === "string" ? nav.params.listId : undefined;
  const { setChrome } = nav;

  // The tab bar's height, so the game's home ends above it.
  useEffect(() => {
    document.body.classList.add("questmode");
    const tabs = document.getElementById("tabs");
    const fit = () => document.body.style.setProperty("--tabs-h", (tabs?.offsetHeight || 0) + "px");
    fit();
    const ro = typeof ResizeObserver !== "undefined" && tabs ? new ResizeObserver(fit) : null;
    if (ro && tabs) ro.observe(tabs);
    return () => {
      ro?.disconnect();
      document.body.classList.remove("questmode", "hunting");
      setChrome(true);
    };
  }, [setChrome]);

  const onScreen = useCallback((sc: string) => {
    const full = FULL.has(sc);
    setChrome(!full);
    document.body.classList.toggle("hunting", full);
  }, [setChrome]);

  const onReceipt = useCallback(() => {
    const sess = source.session();
    if (sess) nav.show("finish", { session: sess });
  }, [source, nav]);

  // Map my store after a trip: the store's map screen, for that store.
  const onMapStore = useCallback((st: { name: string }) => nav.show("mapper", { store: st.name }), [nav]);

  const extra = (
    <div className="qm-links">
      <button id="qm-map-store" className="qg-store" type="button" onClick={() => nav.show("mapper")}>
        <span><b>{t("quest.mapMyStore")}</b><small>{t("quest.mapMyStoreSub")}</small></span><span aria-hidden="true">›</span>
      </button>
      <button className="qg-store" type="button" onClick={() => nav.show("trips")}>
        <span><b>{t("quest.tripsLink")}</b><small>{t("quest.tripsLinkSub")}</small></span><span aria-hidden="true">›</span>
      </button>
    </div>
  );

  return (
    <div className="questmode-host">
      <Suspense fallback={<div className="qm-loading" role="status">{t("quest.openingQuest")}</div>}>
        <QuestGame source={source} store={store} listId={listId} onReceipt={onReceipt} onScreen={onScreen} homeExtra={extra} avatar={avatar} onMapStore={onMapStore} />
      </Suspense>
    </div>
  );
}
