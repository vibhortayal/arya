import { useMemo } from "react";
import { useNav } from "../app/nav";
import { useIsDemo } from "../app/session";
import type { TourStep } from "../ui/Tour";
import type { ViewId } from "../app/views";
import { openGuide } from "../ui/Guide";
import { FIRST_RUN_TOUR } from "./firstRunTour";

/* The demo's per-screen Tour (owner, 2026-10-31): the Tour, but each
 * screen gets a stop for its tab and one stop for each of its main cards,
 * so a first-time demo visitor knows what is on a screen before playing.
 * Words: the Tour is these bubbles; the Arya guide is the swipeable cards;
 * the Help tab is everything else (README, "Names for the help parts").
 * Real accounts keep FIRST_RUN_TOUR. The first step of each screen goes
 * to that tab; "Skip Today" jumps to the next screen. The last step
 * offers the Arya guide. A card that is not on the screen (hidden by
 * Edit Today) shows its bubble over the plain scrim. */
export function demoTour(go: (view: ViewId) => void): TourStep[] {
  const s = (screen: string, view: ViewId, k: string, target: string, placement: TourStep["placement"]): TourStep => ({
    id: `${screen}-${k}`,
    target,
    titleKey: `demoTour.${screen}_${k}.title`,
    bodyKey: `demoTour.${screen}_${k}.line`,
    placement,
    screen: `tabs.${{ today: "today", lists: "lists", ask: "ask", quest: "quest", help: "help", settings: "settings" }[screen]}`,
    onEnter: () => go(view),
  });
  const steps: TourStep[] = [
  s("today", "home", "tab", '#tabs button[data-view="view-home"]', "above"),
  s("today", "home", "low", '#today-low', "below"),
  s("today", "home", "lists", '#today-lists', "below"),
  s("today", "home", "soon", '#today-expiry', "above"),
  s("today", "home", "edit", '#today-editbtn', "below"),
  s("lists", "list", "tab", '#tabs button[data-view="view-list"]', "above"),
  s("lists", "list", "cards", '#list-cards', "below"),
  s("lists", "list", "new", '#list-new', "above"),
  s("ask", "chat", "tab", '#tabs button[data-view="view-chat"]', "above"),
  s("ask", "chat", "box", '#chat-form', "above"),
  s("ask", "chat", "photo", '#ask-photo', "above"),
  s("quest", "community", "tab", '#tabs button[data-view="view-community"]', "above"),
  s("quest", "community", "map", '#qm-map-store', "above"),
  s("help", "help", "tab", '#tabs button[data-view="view-help"]', "above"),
  s("help", "help", "ask", '#help-ask', "below"),
  s("settings", "profile", "tab", '#tabs button[data-view="view-profile"]', "above"),
  s("settings", "profile", "prefs", '#pf-prefs-group', "below"),
  ];
  const last = steps[steps.length - 1];
  steps[steps.length - 1] = { ...last, more: FIRST_RUN_TOUR[FIRST_RUN_TOUR.length - 1].more ?? { labelKey: "firstRun.tour.guideLink", onClick: () => openGuide() } };
  return steps;
}

/* The steps to run: the per-screen Tour in the demo, the six-stop Tour
 * for a real account. Welcome sheet, Help tab and the Arya guide all use it. */
export function useTourSteps(): TourStep[] {
  const nav = useNav();
  const demo = useIsDemo();
  return useMemo(() => (demo ? demoTour(nav.tab) : FIRST_RUN_TOUR), [demo, nav.tab]);
}
