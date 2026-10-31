/* The Arya guide (#154, owner-approved mockup 2026-10-29; the owner's
 * sections 2026-10-30; numbered steps and no links out, 2026-10-30):
 * swipeable cards that tell what Arya does and how to do it. Each card
 * has a short line and 2 to 4 numbered steps that use the app's own
 * button names. Nothing in the guide leaves the cards. Fifteen cards,
 * in a shopper's own order: plan, before the trip, in the store, after
 * the trip, then anytime (owner, 2026-10-31). Cards are data;
 * ui/Guide.tsx draws them. Every text field is an en.json key
 * (guide.*). */

export const GUIDE_IDS = [
  "lists", "share", "running", "news", "shopping", "quest", "maps", "friends", "receipts", "usesoon", "prices", "ask",
  "today", "powers", "settings",
] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export type GuideCard = {
  id: GuideId;
  kickerKey: string;
  titleKey: string;
  bodyKey: string;
  stepKeys: string[];
};

/* Step counts per card. Each step names a row or button the screens
 * show (checked against the app 2026-10-30). */
const STEPS: Record<GuideId, number> = {
  lists: 3, shopping: 4, share: 3, receipts: 3, running: 4, usesoon: 4, prices: 3, quest: 4, maps: 3, news: 2, ask: 4,
  friends: 3, today: 4, powers: 3, settings: 4,
};

export const GUIDE_CARDS: GuideCard[] = GUIDE_IDS.map((id): GuideCard => ({
  id,
  kickerKey: `guide.cards.${id}.kicker`,
  titleKey: `guide.cards.${id}.title`,
  bodyKey: `guide.cards.${id}.body`,
  stepKeys: Array.from({ length: STEPS[id] }, (_, i) => `guide.cards.${id}.s${i + 1}`),
}));

/* Where the guide opens for a card id; an unknown id opens card 1. */
export function guideIndex(id?: string | null): number {
  const i = GUIDE_CARDS.findIndex(c => c.id === id);
  return i < 0 ? 0 : i;
}

/* A power on the Powers page that has a guide card (Powers' (i)
 * sheet links to it). */
export const GUIDE_FOR_POWER: Record<string, GuideId> = {
  lists: "lists", usesoon: "usesoon", receipts: "receipts", patterns: "receipts", compare: "prices", trends: "prices",
  community: "prices", ask: "ask",
};
