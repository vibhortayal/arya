import type { TourStep } from "../ui/Tour";
import type { ViewId } from "../app/views";
import { DEFAULT_BAR, type BarItem } from "../lib/bar";
import { openBarEditor } from "../ui/Bar";

/* The first-run tour (#153): one step per place on the shopper's bar
 * (lib/bar.ts), in bar order, then More, then "Make the bar yours"
 * (owner, 2026-11-01), whose "Customize now" ends the tour and opens
 * the editor. The welcome sheet starts it; Replay the tour in the Arya
 * guide and Help replay it. Run it with useTour().startTour(firstRunTour(bar)). */

/* Each place's Tour text: firstRun.tour.<key>. */
export const TOUR_KEY: Record<BarItem, string> = {
  home: "today", list: "lists", chat: "ask", community: "quest", help: "help", profile: "settings",
  receipts: "receipts", "stores-mine": "stores", analysis: "spending",
};

/* A place's button on the bar, or More when the place is not on it. */
export const tabButton = (view: ViewId) => () =>
  document.querySelector(`#tabs button[data-view="view-${view}"]`) || document.querySelector("#tab-more");

const tab = (view: BarItem): TourStep => ({
  id: TOUR_KEY[view],
  target: tabButton(view),
  titleKey: `firstRun.tour.${TOUR_KEY[view]}.title`,
  bodyKey: `firstRun.tour.${TOUR_KEY[view]}.line`,
  placement: "above",
});

export const MORE_STEP: TourStep = {
  id: "more", target: "#tab-more", titleKey: "firstRun.tour.more.title", bodyKey: "firstRun.tour.more.line", placement: "above",
};
export const BAR_STEP: TourStep = {
  id: "bar", target: "#tabs", titleKey: "firstRun.tour.bar.title", bodyKey: "firstRun.tour.bar.line", placement: "above",
  more: { labelKey: "firstRun.tour.bar.customize", onClick: () => openBarEditor() },
};

export function firstRunTour(bar: BarItem[] = DEFAULT_BAR): TourStep[] {
  return [...bar.map(tab), MORE_STEP, BAR_STEP];
}
