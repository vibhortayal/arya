import type { TourStep } from "../ui/Tour";
import { openGuide } from "../ui/Guide";

/* The first-run tour (#153): one step per tab, in tab order (Help included). The
 * welcome sheet starts it; Replay the tour in the Arya guide replays it.
 * Run it with useTour().startTour(FIRST_RUN_TOUR). The last step
 * offers the Arya guide (#154): its "Want the full guide?" link ends
 * the tour and opens the guide; Done alone just ends it. */
const tab = (view: string, key: string): TourStep => ({
  id: key,
  target: `#tabs button[data-view="view-${view}"]`,
  titleKey: `firstRun.tour.${key}.title`,
  bodyKey: `firstRun.tour.${key}.line`,
  placement: "above",
});

export const FIRST_RUN_TOUR: TourStep[] = [
  tab("home", "today"),
  tab("list", "lists"),
  tab("chat", "ask"),
  tab("community", "quest"),
  tab("help", "help"),
  { ...tab("profile", "settings"), more: { labelKey: "firstRun.tour.guideLink", onClick: () => openGuide() } },
];
