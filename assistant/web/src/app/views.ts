/* Every screen of the app, by its section id minus "view-" (the
 * plain-JS app's ids, kept). Signed out, the app shows Login, which
 * is not a view. The bottom bar shows the ones the shopper picks. */
export const VIEWS = [
  "home", "list", "receipts", "tocheck", "chat", "help", "analysis", "item", "profile",
  "group-join", "quest-progress", "muse", "powers", "about", "feedback", "newlist",
  "stores-find", "stores-mine", "mapper", "capture", "optimize",
  "mode", "hunt", "express", "finish", "score", "album", "community", "race",
  "friends", "receipt", "reveal", "rreview", "haul", "trips", "waitlist", "display", "usage", "ops", "ops-settings", "ai",
] as const;
export type ViewId = (typeof VIEWS)[number];
export type ViewParams = Record<string, unknown>;

/* The bottom bar is the shopper's own (lib/bar.ts): four places, then
 * More. */

/* A pushed page keeps its parent tab lit (UI/UX pass, issue 10).
 * Receipts and Spending open from Lists (PR #340); lib/bar.ts litTab
 * lights a pinned Receipts or Spending first. */
export const PARENT_TAB: Partial<Record<ViewId, ViewId>> = {
  receipts: "list", tocheck: "home", receipt: "list", analysis: "list", powers: "profile", about: "profile", feedback: "profile",
  muse: "profile", waitlist: "profile", display: "profile", usage: "profile", ops: "profile", "ops-settings": "profile", ai: "profile", "stores-mine": "list", "stores-find": "list", "group-join": "profile",
  item: "list", newlist: "list", optimize: "list",
  "quest-progress": "community", trips: "community", mapper: "community", album: "community", friends: "community", race: "community",
};
