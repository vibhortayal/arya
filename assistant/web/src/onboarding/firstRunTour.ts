import type { TourStep } from "../ui/Tour";
import type { ViewId } from "../app/views";
import { DEFAULT_BAR, type BarItem } from "../lib/bar";
import { closeBarSheets, openBarEditor, openMoreSheet } from "../ui/Bar";

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

/* Today's line says where Receipts and Spending are, only when they
 * are not on the shopper's bar (owner, 2026-11-01). */
export const todayLine = (bar: BarItem[]) => {
  const r = !bar.includes("receipts"), s = !bar.includes("analysis");
  return `firstRun.tour.today.${r && s ? "lineBoth" : r ? "lineReceipts" : s ? "lineSpending" : "line"}`;
};

const tab = (view: BarItem, bar: BarItem[]): TourStep => ({
  id: TOUR_KEY[view],
  target: tabButton(view),
  titleKey: `firstRun.tour.${TOUR_KEY[view]}.title`,
  bodyKey: view === "home" ? todayLine(bar) : `firstRun.tour.${TOUR_KEY[view]}.line`,
  placement: "above",
});

/* More opens its sheet, so the step shows what is in it (and More,
 * not the last screen's tab, is lit). The bar step points at Customize
 * bar in that sheet, the button to use, not touch and hold. */
export const MORE_STEP: TourStep = {
  id: "more", target: "#more-sheet .sheet", titleKey: "firstRun.tour.more.title", bodyKey: "firstRun.tour.more.line", placement: "above",
  onEnter: openMoreSheet, onLeave: closeBarSheets,
};
export const BAR_STEP: TourStep = {
  id: "bar", target: "#bar-customize", titleKey: "firstRun.tour.bar.title", bodyKey: "firstRun.tour.bar.line", placement: "above",
  onEnter: openMoreSheet, onLeave: closeBarSheets,
  more: { labelKey: "firstRun.tour.bar.customize", onClick: () => openBarEditor() },
};

export function firstRunTour(bar: BarItem[] = DEFAULT_BAR): TourStep[] {
  return [...bar.map(v => tab(v, bar)), MORE_STEP, BAR_STEP];
}
