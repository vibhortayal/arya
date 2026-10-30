/* Every screen of the app, by its section id minus "view-" (the
 * plain-JS app's ids, kept). Signed out, the app shows Login, which
 * is not a view. The tab bar shows five of them. */
export const VIEWS = [
  "home", "list", "receipts", "chat", "analysis", "item", "profile",
  "group-join", "quest-progress", "muse", "powers", "about", "feedback", "newlist", "store",
  "stores-find", "stores-mine", "stores-add", "mapper", "capture", "optimize",
  "mode", "hunt", "express", "finish", "score", "album", "community", "race",
  "friends", "receipt", "reveal", "rreview", "haul", "trips", "waitlist",
] as const;
export type ViewId = (typeof VIEWS)[number];
export type ViewParams = Record<string, unknown>;

/* Settings (owner, 2026-10-29) is the Profile page as a fifth tab. */
export const TABS: ViewId[] = ["home", "list", "chat", "community", "profile"];

/* A pushed page keeps its parent tab lit (UI/UX pass, issue 10). */
export const PARENT_TAB: Partial<Record<ViewId, ViewId>> = {
  receipts: "profile", receipt: "profile", analysis: "profile", powers: "profile", about: "profile", feedback: "profile",
  muse: "profile", waitlist: "profile", "stores-mine": "profile", "stores-find": "profile", "stores-add": "profile", "group-join": "profile",
  item: "list", newlist: "list", store: "list", optimize: "list",
  "quest-progress": "community", trips: "community", mapper: "community", album: "community", friends: "community", race: "community",
};
