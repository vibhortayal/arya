/* Quest: the whole game as one component. The host gives it a data
 * source and a place to keep the profile; everything else lives in
 * this folder. Screens: hub -> pick a store -> play -> finish.
 * Practice runs on a silent source and never touches the profile. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
};

export default function QuestGame({ source, store, onExit, now = () => new Date(), listId, onReceipt, onScreen, homeExtra }: QuestGameProps) {
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
  /* Walk a built store: practice on its own layout with the player's list (nothing is saved). */
  const walkBuilt = (graph: StoreGraph, name: string) => {
    const src = list?.items.length ? list : PRACTICE_LIST;
    const items = src.items.map((it, i) => ({ key: `${i}-${it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: it.name, art: it.art || artFor(it.name), section: sectionFor(it.name, graph) }));
    const layout = buildLayout({ id: graph.id, name, area: graph.source === "dream" ? "Dream store" : "Your map", kind: "mapped", items, graph });
    setScreen({ s: "play", trip: newTrip(layout, items, { practice: true, seed: Math.floor(Math.random() * 1e6) }) });
  };
  const startQuest = async (st: StoreSummary) => {
    if (!list) return;
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

  const key = screen.s === "play" ? "play" : screen.s;
  return (
    <div className="qg" data-screen={screen.s}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className="qg-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {screen.s === "home" && <Home profile={profile} newbie={newbie} list={list} lists={lists} onList={setList} onPractice={startPractice} onQuest={() => setScreen({ s: "pick" })} onAlbum={() => setScreen({ s: "album" })} onExit={onExit} extra={homeExtra} onBuild={() => setScreen({ s: "build" })} />}
          {screen.s === "build" && <Build source={source} onBack={() => setScreen({ s: "home" })} onWalk={walkBuilt} />}
          {screen.s === "pick" && <Pick source={source} newbie={newbie} onPick={startQuest} onPractice={startPractice} onBack={() => setScreen({ s: "home" })} />}
          {screen.s === "album" && <Album profile={profile} onBack={() => setScreen({ s: "home" })} />}
          {screen.s === "loading" && <div className="qg-loading" role="status">Opening the store…</div>}
          {screen.s === "play" && (
            <Play trip={screen.trip} source={screen.trip.practice ? silent : source}
              onTrip={t => setScreen(sc => (sc.s === "play" ? { s: "play", trip: t } : sc))}
              onFinish={finish} onQuit={() => setScreen({ s: "home" })} />
          )}
          {screen.s === "finish" && (
            <Finish trip={screen.trip} rewards={screen.rewards} profile={profile}
              onDone={() => setScreen({ s: "home" })} onReceipt={!screen.trip.practice ? onReceipt : undefined} onRealQuest={() => setScreen({ s: "pick" })} onAgain={startPractice}
              onRoute={notes => void (screen.trip.practice ? silent : source).report({ kind: "route", store: screen.trip.layout.id, notes, text: "" })} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
