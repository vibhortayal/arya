import { useMemo } from "react";
import { useNav } from "../app/nav";
import { useIsDemo } from "../app/session";
import type { TourStep } from "../ui/Tour";
import type { ViewId } from "../app/views";
import { DEFAULT_BAR, type BarItem } from "../lib/bar";
import { useBar } from "../ui/Bar";
import { BAR_STEP, MORE_STEP, TOUR_KEY, firstRunTour, tabButton } from "./firstRunTour";

/* The demo's per-screen Tour (owner, 2026-10-31): the Tour, but each
 * screen gets a stop for its tab and one stop for each of its main cards,
 * so a first-time demo visitor knows what is on a screen before playing.
 * Words: the Tour is these bubbles; the Arya guide is the swipeable cards;
 * the Help tab is everything else (README, "Names for the help parts").
 * Real accounts get firstRunTour. Screens come in the shopper's bar
 * order (owner, 2026-11-01), then More, Help and Settings, then "Make
 * the bar yours". The first step of each screen goes to that screen;
 * "Skip Today" jumps to the next screen. Done opens the Arya guide. A card that is not on the screen (hidden by
 * Edit Today) shows its bubble over the plain scrim. */
export function demoTour(go: (view: ViewId) => void, bar: BarItem[] = DEFAULT_BAR): TourStep[] {
  const s = (screen: string, view: BarItem, k: string, target: TourStep["target"], placement: TourStep["placement"]): TourStep => ({
    id: `${screen}-${k}`,
    target,
    titleKey: `demoTour.${screen}_${k}.title`,
    bodyKey: `demoTour.${screen}_${k}.line`,
    placement,
    screen: `tabs.${screen}`,
    onEnter: () => go(view),
  });
  // Each screen's stops; its first stop is its button on the bar, or
  // More when the shopper took it off the bar.
  const GROUPS: Partial<Record<BarItem, TourStep[]>> = {
    home: [
      s("today", "home", "tab", tabButton("home"), "above"),
      s("today", "home", "low", '#today-low', "below"),
      s("today", "home", "lists", '#today-lists', "below"),
      s("today", "home", "soon", '#today-expiry', "below"),
      s("today", "home", "edit", '#today-editbtn', "below"),
    ],
    list: [
      s("lists", "list", "tab", tabButton("list"), "above"),
      s("lists", "list", "cards", '#list-cards', "below"),
      s("lists", "list", "new", '#list-new', "above"),
    ],
    chat: [
      s("ask", "chat", "tab", tabButton("chat"), "above"),
      s("ask", "chat", "box", '#chat-form', "above"),
      s("ask", "chat", "photo", 'label[for="ask-photo"]', "above"),
    ],
    community: [
      s("quest", "community", "tab", tabButton("community"), "above"),
      s("quest", "community", "map", '#qm-map-store', "above"),
    ],
    help: [
      s("help", "help", "tab", tabButton("help"), "above"),
      s("help", "help", "ask", '#help-ask', "below"),
    ],
    profile: [
      s("settings", "profile", "tab", tabButton("profile"), "above"),
      s("settings", "profile", "prefs", '#pf-prefs-group', "below"),
    ],
  };
  // A pinned place with no screen stops of its own gets its one Tour step.
  const one = (v: BarItem): TourStep[] => {
    const k = TOUR_KEY[v];
    return [{ id: k, target: tabButton(v), titleKey: `firstRun.tour.${k}.title`, bodyKey: `firstRun.tour.${k}.line`,
      placement: "above", screen: `tabs.${k}`, onEnter: () => go(v) }];
  };
  const steps: TourStep[] = bar.flatMap(v => GROUPS[v] ?? one(v));
  steps.push({ ...MORE_STEP, screen: "tabs.more" });
  // Help and Settings come after More when they are in it.
  for (const v of ["help", "profile"] as const) if (!bar.includes(v)) steps.push(...GROUPS[v]!);
  steps.push({ ...BAR_STEP, screen: "firstRun.tour.bar.screen" });
  return steps;
}

/* The steps to run: the per-screen Tour in the demo, the short Tour
 * for a real account, both following the shopper's bar. Welcome sheet,
 * Help tab and the Arya guide all use it. */
export function useTourSteps(): TourStep[] {
  const nav = useNav();
  const demo = useIsDemo();
  const bar = useBar();
  const key = bar.join();
  return useMemo(() => (demo ? demoTour(nav.tab, bar) : firstRunTour(bar)), [demo, nav.tab, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
