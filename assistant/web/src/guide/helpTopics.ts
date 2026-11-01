import type { ViewId } from "../app/views";

/* The topics on the Help tab (owner pick A, 2026-10-31). Each is data;
 * screens/Help.tsx draws them. Text lives in en.json under
 * help.topics.<id>: title, sub, body, s1..sN (numbered steps),
 * n1..nM (good to know) and cta (the button that opens the feature).
 * The same facts sit in assistant/prompts/arya_features.md, which is
 * what Ask Arya answers from: change one, change the other. */
export type HelpTopic = {
  id: string;
  group: "start" | "how";
  steps: number;
  notes: number;
  /* The screen the button opens, or the bar editor. */
  opens: ViewId | "bar-editor";
};

export const HELP_TOPICS: HelpTopic[] = [
  { id: "receipt", group: "start", steps: 3, notes: 3, opens: "receipts" },
  { id: "additem", group: "start", steps: 4, notes: 2, opens: "list" },
  { id: "ask", group: "start", steps: 3, notes: 2, opens: "chat" },
  { id: "lists", group: "how", steps: 4, notes: 2, opens: "list" },
  { id: "receipts", group: "how", steps: 3, notes: 2, opens: "analysis" },
  { id: "prices", group: "how", steps: 3, notes: 2, opens: "powers" },
  { id: "shopping", group: "how", steps: 3, notes: 2, opens: "community" },
  { id: "map", group: "how", steps: 4, notes: 2, opens: "mapper" },
  { id: "news", group: "how", steps: 3, notes: 2, opens: "home" },
  { id: "share", group: "how", steps: 3, notes: 2, opens: "profile" },
  { id: "usesoon", group: "how", steps: 4, notes: 2, opens: "powers" },
  { id: "ai", group: "how", steps: 3, notes: 3, opens: "about" },
  { id: "customize", group: "how", steps: 3, notes: 2, opens: "home" },
  { id: "bar", group: "how", steps: 3, notes: 2, opens: "bar-editor" },
];
