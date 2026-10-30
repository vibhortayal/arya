/* Quest: the whole game as one component. The host gives it a data
 * source and a place to keep the profile; everything else lives in
 * this folder. Screens: hub -> pick a store -> play -> finish.
 * Practice runs on a silent source and never touches the profile. */
import { useEffect, useRef, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { applyTrip, type Profile, type Rewards } from "./core/meta";
import { ALL_STICKERS, PRACTICE_LIST, PRACTICE_STORE, SilentSource, artFor, type QuestSource } from "./core/source";
import { newTrip, type Trip } from "./core/trip";
import type { ShoppingList, StoreSummary } from "./core/types";
import type { ProfileStore } from "./store";
import { Album, Home, Pick } from "./ui/Hub";
import { Play } from "./ui/Play";
import { Finish } from "./ui/Finish";
import { Build } from "./ui/Build";
import { buildLayout, sectionFor } from "./core/template";
import type { StoreGraph } from "./map/graph";
import "./game.css";

export type Screen =
  | { s: "home" } | { s: "pick" } | { s: "album" } | { s: "loading" } | { s: "build" }
  | { s: "play"; trip: Trip }
  | { s: "finish"; trip: Trip; rewards: Rewards };

/* A real trip at a store Arya has not fully mapped: worth offering Map my store. */
export const needsMap = (t: Trip) => !t.practice && t.layout.kind !== "mapped";

export type QuestGameProps = {
  source: QuestSource; store: ProfileStore; onExit?: () => void; now?: () => Date;
  /* Start on this list (the app's "Shop this list"). */
  listId?: string;
  /* After a real trip: the host's receipt step (the app's Finish screen). */
  onReceipt?: () => void;
  /* Which screen is up, so a host can hide its own chrome while playing. */
  onScreen?: (s: Screen["s"]) => void;
  /* Host links shown at the foot of the game's home (trips, receipts). */
  homeExtra?: ReactNode;
  /* The player's avatar picture: the shopper wears it as a face. */
  avatar?: string | null;
  /* The host's Map my store (owner, 2026-10-29: easy to reach). Offered
   * on a real trip at a store that is not fully mapped: the in-store
   * cue's Map it (which ends the trip, keeping its grabs) and one offer
   * at the end. */
  onMapStore?: (store: { id: string; name: string }) => void;
  /* The app's store search, for Build a store's "Which store?". */
  findStore?: (onAdded: () => void) => ReactNode;
  /* An empty list: where the player adds items (the app's Lists). */
  onAddItems?: () => void;
  /* Open straight into the Practice Market (the host's guide). */
  practice?: boolean;
  /* A saved trip to pick back up (Your trips › Resume). */
  resume?: string;
};

export default function QuestGame({ source, store, onExit, now = () => new Date(), listId, onReceipt, onScreen, homeExtra, avatar, onMapStore, findStore, onAddItems, practice, resume }: QuestGameProps) {
  const [screen, setScreen] = useState<Screen>({ s: "home" });
  const [profile, setProfile] = useState<Profile>(() => store.load());
  const [list, setList] = useState<ShoppingList | null>(null);
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const silent = useMemo(() => new SilentSource(), []);
  const newbie = profile.trips === 0 && !store.flag("practiced");
  useEffect(() => { onScreen?.(screen.s); }, [screen.s, onScreen]);

  useEffect(() => {
    void source.lists().then(l => {
      setLists(l);
      setList(l.find(x => x.id === listId) || l.find(x => x.items.length) || l[0] || null);
    });
  }, [source, listId]);

  const startPractice = async () => {
    setScreen({ s: "loading" });
    const { layout, items } = await silent.open(PRACTICE_STORE.id, PRACTICE_LIST);
    const eggs = items.find(i => i.name === "Eggs")?.key ?? null;
    setScreen({ s: "play", trip: newTrip(layout, items, { practice: true, golden: eggs }) });
  };
  useEffect(() => { if (practice) void startPractice(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Resume a saved trip where it was left: the same items, the grabs in the cart.
  useEffect(() => {
    if (!resume || !source.resume) return;
    setScreen({ s: "loading" });
    void source.resume(resume).then(r => {
      if (!r) { setScreen({ s: "home" }); return; }
      setScreen({ s: "play", trip: { ...newTrip(r.layout, r.items, { seed: Math.floor(Math.random() * 1e6) }), got: r.got } });
    }).catch(() => setScreen({ s: "home" }));
  }, [resume]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Walk a built store: practice on its own layout with the player's list (nothing is saved). */
  const walkBuilt = (graph: StoreGraph, name: string) => {
    const src = list?.items.length ? list : PRACTICE_LIST;
    const items = src.items.map((it, i) => ({ key: `${i}-${it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: it.name, art: it.art || artFor(it.name), section: sectionFor(it.name, graph) }));
    const layout = buildLayout({ id: graph.id, name, area: graph.source === "dream" ? "Dream store" : "Your map", kind: "mapped", items, graph });
    setScreen({ s: "play", trip: newTrip(layout, items, { practice: true, seed: Math.floor(Math.random() * 1e6) }) });
  };
  /* The list's own store: one of the player's stores by that name, else
   * the first search hit. null sends the player to the store pick. */
  const listStore = async (l: ShoppingList | null): Promise<StoreSummary | null> => {
    if (!l?.store) return null;
    const want = l.store.trim().toLowerCase();
    const hit = (rows: StoreSummary[]) => rows.find(s => s.name.trim().toLowerCase() === want) || null;
    return hit(await source.nearbyStores().catch(() => [])) || hit(await source.findStores(l.store).catch(() => []));
  };
  const quest = async () => {
    const st = await listStore(list);
    if (st) void startQuest(st); else setScreen({ s: "pick" });
  };
  /* Start shopping on a list (the Lists tab) goes straight to that
   * list's store, once; a first-timer still sees practice first. */
  const went = useRef(false);
  useEffect(() => {
    if (went.current || practice || newbie || !listId || list?.id !== listId || !list.items.length || !list.store) return;
    went.current = true;
    void listStore(list).then(st => { if (st) void startQuest(st); });
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const startQuest = async (st: StoreSummary) => {
    if (!list?.items.length) { setScreen({ s: "home" }); return; }
    setScreen({ s: "loading" });
    const { layout, items } = await source.open(st.id, list);
    setScreen({ s: "play", trip: newTrip(layout, items, { seed: Math.floor(Math.random() * 1e6) }) });
  };
  const finish = (trip: Trip) => {
    const r = applyTrip(profile, trip, now(), ALL_STICKERS, Math.floor(Math.random() * 1e6));
    if (trip.practice) store.setFlag("practiced");
    else {
      store.save(r.profile); setProfile(r.profile);
      void source.finish?.({ got: trip.items.filter(i => trip.got.includes(i.key)).map(i => i.name), points: trip.points });
    }
    setScreen({ s: "finish", trip, rewards: r.rewards });
  };

  /* "Map it now" mid-trip: a trip with grabs ends (they stay checked off
   * on the list); an empty one was never saved. Then the host's Map my store. */
  const mapNow = async (trip: Trip) => {
    if (trip.got.length && source.end) await source.end().catch(() => {});
    setScreen({ s: "home" });
    onMapStore?.({ id: trip.layout.id, name: trip.layout.name });
  };

  const key = screen.s === "play" ? "play" : screen.s;
  return (
    <div className="qg" data-screen={screen.s}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className="qg-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {screen.s === "home" && <Home profile={profile} newbie={newbie} list={list} lists={lists} onList={setList} onPractice={startPractice} onQuest={() => void quest()} onPick={() => setScreen({ s: "pick" })} onAlbum={() => setScreen({ s: "album" })} onExit={onExit} extra={homeExtra} onBuild={() => setScreen({ s: "build" })} onAddItems={onAddItems} />}
          {screen.s === "build" && <Build source={source} onBack={() => setScreen({ s: "home" })} onWalk={walkBuilt} findStore={findStore} />}
          {screen.s === "pick" && <Pick source={source} newbie={newbie} first={list?.store} onPick={startQuest} onPractice={startPractice} onBack={() => setScreen({ s: "home" })} />}
          {screen.s === "album" && <Album profile={profile} onBack={() => setScreen({ s: "home" })} />}
          {screen.s === "loading" && <div className="qg-loading" role="status">Opening the store…</div>}
          {screen.s === "play" && (
            <Play trip={screen.trip} avatar={avatar} source={screen.trip.practice ? silent : source}
              onTrip={t => setScreen(sc => (sc.s === "play" ? { s: "play", trip: t } : sc))}
              onFinish={finish} onQuit={() => setScreen({ s: "home" })} onEnd={source.end ? async () => { await source.end!(); setScreen({ s: "home" }); } : undefined}
              onMap={onMapStore && needsMap(screen.trip) ? () => void mapNow(screen.trip) : undefined} />
          )}
          {screen.s === "finish" && (
            <Finish trip={screen.trip} rewards={screen.rewards} profile={profile}
              onDone={() => setScreen({ s: "home" })} onReceipt={!screen.trip.practice ? onReceipt : undefined} onRealQuest={() => setScreen({ s: "pick" })} onAgain={startPractice}
              onMap={onMapStore && needsMap(screen.trip) ? () => onMapStore({ id: screen.trip.layout.id, name: screen.trip.layout.name }) : undefined}
              onRoute={notes => void (screen.trip.practice ? silent : source).report({ kind: "route", store: screen.trip.layout.id, notes, text: "" })} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
