# 2026-10-29 — Arya guide (#154)

Built the owner-approved swipeable guide (mockup 2026-10-29) in the
React app. Branch `feat/arya-guide`; no PR yet. No model calls, $0.

## What changed
- **Guide (`web/src/ui/Guide.tsx`).** A full-screen overlay: "Arya
  guide · N of 8", a round x, dots, Back (from card 2), Next, Done on
  the last card. Swipe left or right, arrow keys, Esc to close.
  `role="dialog"`, focus on Next, focus trapped, focus goes back to the
  opener. Cards slide in, except under prefers-reduced-motion.
  `useGuide().open(id?)` opens at a card id; `openGuide(id)` does the
  same from code outside React. `GuideProvider` sits inside
  `TourProvider` in `App.tsx`.
- **Cards (`web/src/guide/cards.ts`).** Eight cards as data: What Arya
  is, Lists, Use soon, Receipts and spending, Prices, Ask Arya, Quest
  (optional), Quick how-tos. All text in en.json (`guide.*`).
- **Try it (`web/src/ui/GuideTry.tsx`).** Client-side sample data only;
  nothing is saved and nothing is sent (vitest stubs fetch and asserts
  zero calls; the e2e checks no non-GET API request and the real lists
  are unchanged). Each sheet has the blue Sample tag and "Try it here.
  Nothing is saved." Lists: a sample Trader Joe's list, typed items go
  on top with "Just added" and an aisle from a small local table; "Make
  my real list" closes the guide and opens the real new-list sheet. Use
  soon: Snap turns a sample pack into a "Use by Friday" row. Receipts:
  File it, then this receipt by category as the Analysis bars
  (`.month-row`). Prices: two sample receipts, then the comparison. Ask:
  three chips with scripted answers in the Ask bubbles.
- **Quest.** A Practice Market exists on main, so Quest's Try it closes
  the guide and opens the Quest tab with `{ practice: true }`;
  `QuestGame` takes a new `practice` prop and starts practice on mount.
- **How-tos.** Five rows of 2 to 4 steps, checked against the screens
  (Receipts row, list camera receipt offer, Start shopping > Quest,
  Settings > Start a group > Invite someone, Today > Snap a date > Take
  a photo > Looks right, track it, Ask tab with mic and suggestions).
- **Ways in.** Settings row "Arya guide" just above Arya's powers.
  Powers: "See how it works" under the subtitle; a power's (i) sheet
  has "See it in the guide" for lists, use soon, receipts, compare,
  trends and ask (`GUIDE_FOR_POWER`). Tour: `TourStep` gains an
  optional `more` link; the first-run tour's last step uses it for
  "Want the full guide?" (ends the tour as Done, then opens the guide).
  Done alone does not open it. The guide never shows by itself.

## Different from the mockup
- Lists bullet 3 says "Arya walks you through the store, item by item":
  the list itself does not sort by aisle on main.
- The Try-it line is "Try it here. Nothing is saved." (the brief), not
  the mockup's "... saved to your lists."
- The Arya guide row sits under "Show me around again" (added after the
  mockup was shot), still just above Arya's powers.
- No yogurt character exists: the Use soon sample shows `dairy.webp`.
- Analysis has no spending by category; the receipt Try it shows "This
  receipt by category" so it does not promise a screen that is not
  there.

## Checks
- `npx tsc -b`, vitest 243 (new `src/guide/guide.test.tsx`: cards,
  sample logic, Next/Back/Done, keys, swipe, open at an id, Quest
  practice, no fetch in any Try it, tour link), `npm run build`.
- e2e 37/37 (new `e2e/guide.e2e.mjs`; `firstrun` also checks the link
  shows only on the last step and Done does not open the guide).
- Python: 1,234 tests, only the 3 sandbox `test_decode` errors.
- Screenshots: `/mnt/project-files/arya-design-pass/guide-built/`.
  Settings and Powers with the two new links removed are
  pixel-identical to `main` (0 diff pixels).

## Next
- Owner review of the built cards and the five departures above.
