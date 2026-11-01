import { lazy, useState, type ComponentType } from "react";
import type { ViewId } from "../app/views";
import { Today } from "./Today";

/* Every screen but Today is its own chunk: the first paint downloads the
 * shell and Today, not the whole app. App wraps the screen in Suspense.
 * The tab screens are fetched once the app is idle (preloadTabScreens),
 * so a tab tap does not wait on the network. */
type Preloadable = ComponentType & { preload?: () => Promise<unknown> };
function screen<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType {
  // Once the chunk is in (preloaded on idle), the screen renders at once
  // instead of suspending for a frame on a blank page (speed audit #28).
  // Each mount picks one of the two and keeps it, so state is never lost.
  let ready: ComponentType<object> | null = null;
  const get = () => load().then(m => { ready = m[name] as ComponentType<object>; return { default: ready }; });
  const Lazy = lazy(get);
  const Screen: Preloadable = (props: object) => {
    const [C] = useState(() => ready);
    return C ? <C {...props} /> : <Lazy {...props} />;
  };
  Screen.preload = get;
  return Screen;
}

const About = screen(() => import("./About"), "About");
const Analysis = screen(() => import("./Analysis"), "Analysis");
const Chat = screen(() => import("./Chat"), "Chat");
const Help = screen(() => import("./Help"), "Help");
const Feedback = screen(() => import("./Feedback"), "Feedback");
const GroupJoin = screen(() => import("./GroupJoin"), "GroupJoin");
const NewList = screen(() => import("./NewList"), "NewList");
const StoresMine = screen(() => import("./StoresMine"), "StoresMine");
const Capture = screen(() => import("./Capture"), "Capture");
const Item = screen(() => import("./Item"), "Item");
const Mapper = screen(() => import("./Mapper"), "Mapper");
const Mode = screen(() => import("./Mode"), "Mode");
const Muse = screen(() => import("./Muse"), "Muse");
const Optimize = screen(() => import("./Optimize"), "Optimize");
const Lists = screen(() => import("./Lists"), "Lists");
const Quest = screen(() => import("./Quest"), "Quest");
const StoresFind = screen(() => import("./StoresFind"), "StoresFind");
const Powers = screen(() => import("./Powers"), "Powers");
const Display = screen(() => import("./Display"), "Display");
const Profile = screen(() => import("./Profile"), "Profile");
const QuestProgress = screen(() => import("./QuestProgress"), "QuestProgress");
const Receipt = screen(() => import("./Receipt"), "Receipt");
const Receipts = screen(() => import("./Receipts"), "Receipts");
const ToCheck = screen(() => import("./ToCheck"), "ToCheck");
const Album = screen(() => import("./Album"), "Album");
const Express = screen(() => import("./Express"), "Express");
const Finish = screen(() => import("./Finish"), "Finish");
const Friends = screen(() => import("./Friends"), "Friends");
const Hunt = screen(() => import("./Hunt"), "Hunt");
const Race = screen(() => import("./Race"), "Race");
const Score = screen(() => import("./Score"), "Score");
const HaulCard = screen(() => import("./haul/HaulCard"), "HaulCard");
const QuestMode = screen(() => import("./quest/QuestMode"), "QuestMode");
const ReceiptReview = screen(() => import("./haul/ReceiptReview"), "ReceiptReview");
const Reveal = screen(() => import("./haul/Reveal"), "Reveal");
const WaitlistAdmin = screen(() => import("./WaitlistAdmin"), "WaitlistAdmin");
const Usage = screen(() => import("./Usage"), "Usage");
const Ops = screen(() => import("./Ops"), "Ops");
const AiNotice = screen(() => import("./AiNotice"), "AiNotice");

/* One entry per screen: the type makes every view in app/views.ts
 * name its screen. Signed out, App renders Login instead. */
export const SCREENS: Record<ViewId, ComponentType> = {
  about: About,
  analysis: Analysis,
  chat: Chat,
  help: Help,
  feedback: Feedback,
  waitlist: WaitlistAdmin,
  usage: Usage,
  ops: Ops,
  ai: AiNotice,
  "group-join": GroupJoin,
  newlist: NewList,
  "stores-mine": StoresMine,
  capture: Capture,
  community: QuestMode,
  trips: Quest,
  mapper: Mapper,
  mode: Mode,
  muse: Muse,
  optimize: Optimize,
  home: Today,
  item: Item,
  list: Lists,
  "stores-find": StoresFind,
  powers: Powers,
  display: Display,
  profile: Profile,
  "quest-progress": QuestProgress,
  receipt: Receipt,
  receipts: Receipts,
  tocheck: ToCheck,
  album: Album,
  express: Express, // only for Express runs started before Quest mode (#158)
  finish: Finish,
  friends: Friends,
  hunt: Hunt,
  race: Race,
  score: Score,
  reveal: Reveal,
  rreview: ReceiptReview,
  haul: HaulCard,
};

/* Lists, Ask, Quest, Help, Settings: the tabs beside Today. */
export function preloadTabScreens() {
  for (const v of ["list", "chat", "community", "help", "profile"] as const) {
    (SCREENS[v] as Preloadable).preload?.().catch(() => { /* offline: the tap loads it, or shows the skeleton */ });
  }
}
