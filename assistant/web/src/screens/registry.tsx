import type { ComponentType } from "react";
import type { ViewId } from "../app/views";
import { About } from "./About";
import { Analysis } from "./Analysis";
import { Chat } from "./Chat";
import { Feedback } from "./Feedback";
import { GroupJoin } from "./GroupJoin";
import { NewList } from "./NewList";
import { Store } from "./Store";
import { StoresMine } from "./StoresMine";
import { Capture } from "./Capture";
import { Item } from "./Item";
import { Mapper } from "./Mapper";
import { Mode } from "./Mode";
import { Muse } from "./Muse";
import { Optimize } from "./Optimize";
import { Lists } from "./Lists";
import { Quest } from "./Quest";
import { StoresAdd } from "./StoresAdd";
import { StoresFind } from "./StoresFind";
import { Today } from "./Today";
import { Powers } from "./Powers";
import { Profile } from "./Profile";
import { QuestProgress } from "./QuestProgress";
import { Receipt } from "./Receipt";
import { Receipts } from "./Receipts";
import { Album } from "./Album";
import { Express } from "./Express";
import { Finish } from "./Finish";
import { Friends } from "./Friends";
import { Hunt } from "./Hunt";
import { Race } from "./Race";
import { Score } from "./Score";
import { HaulCard } from "./haul/HaulCard";
import { QuestMode } from "./quest/QuestMode";
import { ReceiptReview } from "./haul/ReceiptReview";
import { Reveal } from "./haul/Reveal";
import { WaitlistAdmin } from "./WaitlistAdmin";
import { Usage } from "./Usage";

/* One entry per screen: the type makes every view in app/views.ts
 * name its screen. Signed out, App renders Login instead. */
export const SCREENS: Record<ViewId, ComponentType> = {
  about: About,
  analysis: Analysis,
  chat: Chat,
  feedback: Feedback,
  waitlist: WaitlistAdmin,
  usage: Usage,
  "group-join": GroupJoin,
  newlist: NewList,
  store: Store,
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
  "stores-add": StoresAdd,
  "stores-find": StoresFind,
  powers: Powers,
  profile: Profile,
  "quest-progress": QuestProgress,
  receipt: Receipt,
  receipts: Receipts,
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
