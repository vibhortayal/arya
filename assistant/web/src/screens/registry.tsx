import type { ComponentType } from "react";
import { VIEWS, type ViewId } from "../app/views";
import { NotPorted } from "./NotPorted";
import { About } from "./About";
import { Analysis } from "./Analysis";
import { Feedback } from "./Feedback";
import { Receipts } from "./Receipts";

/* One entry per screen. A screen not ported yet shows NotPorted,
 * which links to the same screen in the current app. Porting a
 * screen = add its file and one line here (PORTING.md). */
const PORTED: Partial<Record<ViewId, ComponentType>> = {
  about: About,
  analysis: Analysis,
  feedback: Feedback,
  receipts: Receipts,
};

export const SCREENS = Object.fromEntries(
  VIEWS.map(v => [v, PORTED[v] || (() => <NotPorted view={v} />)]),
) as Record<ViewId, ComponentType>;

export const portedViews = () => Object.keys(PORTED) as ViewId[];
