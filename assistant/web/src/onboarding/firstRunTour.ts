import type { TourStep } from "../ui/Tour";

/* The first-run tour (#153): one step per tab, in tab order. The
 * welcome sheet starts it; Settings > Show me around again replays it.
 * Run it with useTour().startTour(FIRST_RUN_TOUR). */
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
  tab("profile", "settings"),
];
