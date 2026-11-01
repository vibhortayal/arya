import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNav } from "../../app/nav";
import { get } from "../../lib/api";
import { clearOnSignOut, useSession } from "../../app/session";
import { useAvatar } from "../../app/avatar";
import { loadGameDoc, serverProfileStore, type GameDoc } from "./serverProfile";
import { AppSource } from "./appSource";
import { FindStorePanel } from "../StoresFind";
import { markQuestOpened } from "../../lib/questSeen";
import { useTranslation } from "../../i18n";
import { EditList, EditTitle } from "../../ui/EditList";
import { useToast } from "../../ui/Toast";
import { arrange } from "../../lib/layout";

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
/* The game's profile from the last visit, for this account. */
let docMem: { user: string | null; doc: GameDoc } | null = null;
clearOnSignOut(() => { docMem = null; });

const FULL = new Set(["play", "finish", "loading"]);

export function QuestMode() {
  const { t } = useTranslation();
  const nav = useNav();
  const avatar = useAvatar().src;
  const s = useSession();
  const source = useMemo(() => new AppSource(), []);
  // One level, streak and album: the game's profile lives on the server.
  // A return visit draws at once from the last copy (re-audit N4, as
  // Today keeps todayMem); the fresh read refreshes the copy behind.
  const [doc, setDoc] = useState<GameDoc | null | undefined>(() => (docMem && docMem.user === s.user ? docMem.doc : undefined));
  useEffect(() => {
    const user = s.user;
    void loadGameDoc().then(d => {
      const kept = docMem && docMem.user === user ? docMem.doc : null;
      // Refresh the kept copy in place: this visit's store saves into it.
      if (kept) { if (d) Object.assign(kept, d); return; }
      if (d) docMem = { user, doc: d };
      setDoc(d);
    });
  }, [s.user]);
  const store = useMemo(() => doc === undefined ? null : serverProfileStore(`arya-quest:${s.user || "guest"}`, doc), [s.user, doc]);
  const listId = typeof nav.params.listId === "string" ? nav.params.listId : undefined;
  // nav.params.practice starts the Practice Market.
  const practice = nav.params.practice === true;
  // Your trips › Resume on a Quest trip picks it back up in the game.
  const resume = typeof nav.params.resume === "string" ? nav.params.resume : undefined;
  const { setChrome } = nav;

  // Opening Quest once retires Today's Quest nudge for this account.
  useEffect(() => { markQuestOpened(s.user); }, [s.user]);

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

  // Build a store's "Which store?": the same search and add as Find stores.
  const findStore = useCallback((onAdded: () => void) => <FindStorePanel onAdded={onAdded} />, []);

  const onAddItems = useCallback(() => nav.show("list"), [nav]);

  // Map my store row: says when a walk is being read or is ready to check.
  const [mapState, setMapState] = useState<"" | "building" | "ready">("");
  useEffect(() => {
    get<{ jobs: { status: string; seen: boolean }[] }>("/api/storemap/jobs").then(r => {
      const jobs = r.jobs || [];
      setMapState(jobs.some(j => j.status === "ready" && !j.seen) ? "ready"
        : jobs.some(j => j.status === "queued" || j.status === "reading") ? "building" : "");
    }).catch(() => {});
  }, [nav.key]);

  const panels = {
    map: (
      <div className="qm-links">
        <button id="qm-map-store" className={"qg-store" + (mapState === "ready" ? " qm-ready" : "")} type="button" onClick={() => nav.show("mapper")}>
          <span><b>{t("quest.mapMyStore")}</b><small>{t(mapState === "ready" ? "quest.mapReadySub" : mapState === "building" ? "quest.mapBuildingSub" : "quest.mapMyStoreSub")}</small></span><span aria-hidden="true">›</span>
        </button>
      </div>
    ),
    progress: (
      <div className="qm-links">
        <button id="qm-progress" className="qg-store" type="button" onClick={() => nav.show("quest-progress")}>
          <span><b>{t("common.questProgress")}</b><small>{t("quest.progressSub")}</small></span><span aria-hidden="true">›</span>
        </button>
      </div>
    ),
    trips: (
      <div className="qm-links">
        <button className="qg-store" type="button" onClick={() => nav.show("trips")}>
          <span><b>{t("quest.tripsLink")}</b><small>{t("quest.tripsLinkSub")}</small></span><span aria-hidden="true">›</span>
        </button>
      </div>
    ),
  };

  /* Edit Quest (card library, owner 2026-10-30): the same edit mode as
   * Today. Ready for a quest and Map my store always stay (Play, and
   * the owner's keep-Map-my-store rule); the rest hide and reorder. */
  const { toast, showErr } = useToast();
  const [editing, setEditing] = useState(false);
  const lay = s.layouts.quest || {};
  const ids = ["cta", "stats", "map", "progress", "trips", "album", "stores"] as const;
  type PanelId = (typeof ids)[number];
  const keep = (id: string) => id === "cta" || id === "map";
  const { shown, hidden } = arrange([...ids], lay.order, (lay.hidden || []).filter(h => !keep(h)));
  const order = shown.filter(id => id !== "stats");
  function saveQuest(next: string[], msg?: string) {
    const prev = lay;
    const v = { order: next, hidden: ids.filter(id => !next.includes(id) && !keep(id)) };
    s.saveLayout("quest", v).catch(e => { s.saveLayout("quest", prev).catch(() => {}); showErr(e); });
    if (msg) toast(msg, { action: t("common.undo"), onAction: () => { s.saveLayout("quest", prev).catch(showErr); } });
  }
  const pname = (id: PanelId) => t(`quest.edit.${id}.name`);

  return (
    <div className="questmode-host">
      <Suspense fallback={<QuestSkeleton />}>
        {editing && (
          <div className="qm-edit" id="quest-edit">
            <EditTitle title={t("quest.edit.title")} editTitle={t("quest.edit.title")} editing onToggle={() => setEditing(false)} id="quest-editdone" />
            <EditList<PanelId> id="quest-editlist" on={shown as PanelId[]} off={hidden as PanelId[]} name={pname}
              sub={id => t(`quest.edit.${id}.desc`)} desc={id => t(`quest.edit.${id}.desc`)} locked={keep}
              hint={t("quest.edit.hint")} moreTitle={t("edit.more")}
              onChange={(next, msg) => saveQuest(next, msg)}
              onReset={() => { const prev = lay; s.saveLayout("quest", {}).catch(showErr); toast(t("quest.edit.resetDone"), { action: t("common.undo"), onAction: () => { s.saveLayout("quest", prev).catch(showErr); } }); }}
              resetLabel={t("quest.edit.reset")} />
          </div>
        )}
        <div hidden={editing} className="qm-game">
        {!store ? <QuestSkeleton /> : <QuestGame source={source} store={store} listId={listId} onReceipt={onReceipt} onScreen={onScreen} homePanels={panels} homeOrder={order} homeHidden={hidden} onEditHome={() => setEditing(true)} avatar={avatar} onMapStore={onMapStore} findStore={findStore} onAddItems={onAddItems} practice={practice} resume={resume} />}
        </div>
      </Suspense>
    </div>
  );
}

/* The first visit draws the home's shape at once (re-audit N4, mockup
 * approved 2026-11-01): the title, the Play/Build bar, the picture,
 * the main card and two rows, in the places the real home puts them.
 * Its own styles (styles.css .qm-skel): game.css is not loaded yet. */
function QuestSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="qm-skel" role="status" aria-label={t("quest.openingQuest")}>
      <h1>{t("tabs.quest")}</h1>
      <div className="qms-sk qms-seg" />
      <div className="qms-sk qms-hero" />
      <div className="qms-card">
        <span className="qms-line" style={{ width: "42%" }} /><span className="qms-line qms-big" style={{ width: "72%" }} />
        <span className="qms-line" style={{ width: "94%" }} /><span className="qms-line" style={{ width: "86%" }} /><span className="qms-line" style={{ width: "58%" }} />
        <div className="qms-sk qms-btn" />
      </div>
      <div className="qms-card qms-row"><span className="qms-line" style={{ width: "40%" }} /><span className="qms-line qms-sm" style={{ width: "66%" }} /></div>
      <div className="qms-card qms-row"><span className="qms-line" style={{ width: "44%" }} /><span className="qms-line qms-sm" style={{ width: "60%" }} /></div>
    </div>
  );
}
