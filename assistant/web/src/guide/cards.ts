/* The Arya guide (#154, owner-approved mockup 2026-10-29; the owner's
 * sections 2026-10-30; numbered steps and no links out, 2026-10-30):
 * swipeable cards that tell what Arya does and how to do it. Each card
 * has a short line and 2 to 4 numbered steps that use the app's own
 * button names. Nothing in the guide leaves the cards. Cards are data;
 * ui/Guide.tsx draws them. Every text field is an en.json key
 * (guide.*). */

export const GUIDE_IDS = ["lists", "share", "maps", "news", "receipts", "prices", "usesoon", "ask"] as const;
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
const STEPS: Record<GuideId, number> = { lists: 3, share: 3, maps: 3, news: 2, receipts: 3, prices: 3, usesoon: 4, ask: 3 };

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
