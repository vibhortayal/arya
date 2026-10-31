/* Every screen of the app, by its section id minus "view-" (the
 * plain-JS app's ids, kept). Signed out, the app shows Login, which
 * is not a view. The tab bar shows six of them. */
export const VIEWS = [
  "home", "list", "receipts", "chat", "help", "analysis", "item", "profile",
  "group-join", "quest-progress", "muse", "powers", "about", "feedback", "newlist",
  "stores-find", "stores-mine", "mapper", "capture", "optimize",
  "mode", "hunt", "express", "finish", "score", "album", "community", "race",
  "friends", "receipt", "reveal", "rreview", "haul", "trips", "waitlist", "display", "usage", "ops",
] as const;
export type ViewId = (typeof VIEWS)[number];
export type ViewParams = Record<string, unknown>;

/* Settings (owner, 2026-10-29) is the Profile page as a tab; Help (owner,
 * 2026-10-31, option A) sits beside it. */
export const TABS: ViewId[] = ["home", "list", "chat", "community", "help", "profile"];

/* A pushed page keeps its parent tab lit (UI/UX pass, issue 10). */
export const PARENT_TAB: Partial<Record<ViewId, ViewId>> = {
  receipts: "home", receipt: "home", analysis: "home", powers: "profile", about: "profile", feedback: "profile",
  muse: "profile", waitlist: "profile", display: "profile", usage: "profile", ops: "profile", "stores-mine": "list", "stores-find": "list", "group-join": "profile",
  item: "list", newlist: "list", optimize: "list",
  "quest-progress": "community", trips: "community", mapper: "community", album: "community", friends: "community", race: "community",
};
