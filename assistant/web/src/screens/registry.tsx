import type { ComponentType } from "react";
import { VIEWS, type ViewId } from "../app/views";
import { NotPorted } from "./NotPorted";
import { About } from "./About";
import { Analysis } from "./Analysis";
import { Chat } from "./Chat";
import { Feedback } from "./Feedback";
import { GroupJoin } from "./GroupJoin";
import { NewList } from "./NewList";
import { Store } from "./Store";
import { StoresMine } from "./StoresMine";
import { Item } from "./Item";
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

/* One entry per screen. A screen not ported yet shows NotPorted,
 * which links to the same screen in the current app. Porting a
 * screen = add its file and one line here (PORTING.md). */
const PORTED: Partial<Record<ViewId, ComponentType>> = {
  about: About,
  analysis: Analysis,
  chat: Chat,
  feedback: Feedback,
  "group-join": GroupJoin,
  newlist: NewList,
  store: Store,
  "stores-mine": StoresMine,
  community: Quest,
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
};

export const SCREENS = Object.fromEntries(
  VIEWS.map(v => [v, PORTED[v] || (() => <NotPorted view={v} />)]),
) as Record<ViewId, ComponentType>;

export const portedViews = () => Object.keys(PORTED) as ViewId[];
