/* Port of pwa/haul.js HaulCore: the pure helpers of the haul slice
 * (count-up, hide toggles, audience words, the Same haul pick, the
 * owner's private lines, the post payload and the sample card). */

export const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* The count-up. k runs 0..1; the curve eases out and ends exactly
 * on the target, so the shown number is never off by one. */
export function countStep(from: number, to: number, k: number): number {
  if (!(k < 1)) return to;
  if (!(k > 0)) return from;
  const e = 1 - Math.pow(1 - k, 3);
  return Math.round(from + (to - from) * e);
}

/* "Tap anywhere" lands here: every tile shown, number at target. */
export function revealFinal(total: number, tiles: number) {
  return { shown: tiles, value: total };
}

export function toggleHidden(set: Iterable<string> | null | undefined, key: string): Set<string> {
  const out = new Set(set || []);
  if (out.has(key)) out.delete(key); else out.add(key);
  return out;
}

export function statsLabel(stats?: { items?: number; new?: number; level?: number } | null) {
  const s = stats || {};
  return `${s.items || 0} items · ${s.new || 0} new · level ${s.level || 1}`;
}

/* '@priya', '@priya and @dev', '@a, @b and @c', '@a, @b and 3 more'. */
export function sheetAudienceText(handles: string[] | null | undefined): string {
  const h = (handles || []).map(x => "@" + String(x).replace(/^@/, ""));
  if (h.length === 0) return "";
  if (h.length === 1) return h[0];
  if (h.length === 2) return `${h[0]} and ${h[1]}`;
  if (h.length === 3) return `${h[0]}, ${h[1]} and ${h[2]}`;
  return `${h[0]}, ${h[1]} and ${h.length - 2} more`;
}

export type PickRow = { name: string; checked: boolean; note: string };
/* The Same haul sheet: one row per item. What is already on the
 * Arya list, or already queued for the next hunt (from any post),
 * starts unticked and says so. */
export function queuePick(items: (string | { name: string })[], onListNames: string[], queuedNames: string[]): PickRow[] {
  const has = (names: string[], name: string) => {
    const have = (names || []).map(norm).filter(Boolean);
    const n = norm(name);
    return !!n && have.some(h => h === n || (" " + h + " ").includes(" " + n + " ") || (" " + n + " ").includes(" " + h + " "));
  };
  return (items || []).map(it => {
    const name = typeof it === "string" ? it : it.name;
    const queued = (queuedNames || []).map(norm).includes(norm(name));
    const dupe = !queued && has(onListNames, name);
    return { name, checked: !(dupe || queued),
             note: queued ? "Already in your next hunt" : dupe ? "Already on your list" : "" };
  });
}

/* How many rows of one post the server queue holds. */
export function queuedCount(rows: { post_id?: string }[] | null | undefined, postId: string) {
  return (rows || []).filter(r => r && r.post_id === postId).length;
}

/* The words after a Same haul tap. Counts come from the server, not
 * from the ticks, because the queue drops names it already holds. */
export function sameToast(added: number, asked: number) {
  if (added <= 0) return "Nothing new to add. Your next hunt has these already, or it is full.";
  const one = `${added} ${added === 1 ? "item" : "items"} added to your next hunt.`;
  return added < asked ? one + " The rest were there already." : one;
}

export type Bucket = "on_receipt_only" | "grabbed_only" | "swapped";
export type FixLabel = { yes: string; no: string; yesKind: string; noKind: string; none: string };
/* Chip words per review section. */
export function fixLabel(bucket: string): FixLabel | null {
  return ({
    on_receipt_only: { yes: "Add to album", no: "Leave out", yesKind: "extra_add", noKind: "extra_drop", none: "extra_none" },
    grabbed_only: { yes: "Keep", no: "Remove from haul", yesKind: "grabbed_keep", noKind: "grabbed_drop", none: "grabbed_none" },
    swapped: { yes: "Yes, swapped", no: "No", yesKind: "swap_ok", noKind: "swap_no", none: "swap_none" },
  } as Record<string, FixLabel>)[bucket] || null;
}

export type Private = { estimate?: number | null; actual?: number | null; estimate_items?: number; grabbed_items?: number } | null;
/* The owner's private lines. A pair "About X · Receipt Y" shows only
 * when the estimate prices every grabbed item. With fewer, the
 * estimate says how many it covers and the receipt is its own line,
 * so two different sums never read as one comparison. */
export function privateLines(pv: Private | undefined, fmt: (n: number) => string): { label: string; text: string }[] {
  if (!pv || (pv.estimate == null && pv.actual == null)) return [];
  const n = pv.estimate_items || 0, m = pv.grabbed_items || 0;
  const full = pv.estimate != null && m > 0 && n >= m;
  if (full || pv.estimate == null) {
    const est = pv.estimate != null ? `About ${fmt(pv.estimate)}` : "";
    const act = pv.actual != null ? `Receipt ${fmt(pv.actual)}` : "";
    return [{ label: "Estimate vs actual (only you)", text: [est, act].filter(Boolean).join(" · ") }];
  }
  const rows = [{ label: "Estimate (only you)", text: `About ${fmt(pv.estimate)} for ${n} of ${m} items` }];
  if (pv.actual != null) rows.push({ label: "Receipt total (only you)", text: fmt(pv.actual) });
  return rows;
}

/* What a post may carry from the client: a name and a stock art
 * file per item. Nothing else is copied across. */
export function postPayload(items: { name: string; art?: string }[]) {
  return { items: (items || []).map(i => ({ name: String(i.name), art: String(i.art || "basket.webp") })) };
}

export type FeedPost = {
  post_id: string; author: string; sample?: boolean; name: string;
  items: { name: string; art?: string }[];
  stats?: { items?: number; new_finds?: number; level?: number };
  my_reaction: string | null;
};
/* The labelled example card shown while the Crew feed is empty. */
export function sampleHaul(): FeedPost {
  return {
    post_id: "sample", author: "sample-priya", sample: true,
    name: "Sunday Fruit Bowl Run",
    items: ([["Mandarins", "mandarin.webp"], ["Bananas", "banana.webp"],
      ["Blueberries", "blueberry.webp"], ["Raspberries", "raspberry.webp"],
      ["Strawberries", "fruit.webp"], ["Apples", "fruit.webp"],
      ["Kiwi", "fruit.webp"], ["Grapes", "fruit.webp"], ["Lemons", "fruit.webp"]] as [string, string][])
      .map(([name, art]) => ({ name, art })),
    stats: { items: 9, new_finds: 2, level: 4 },
    my_reaction: null,
  };
}
