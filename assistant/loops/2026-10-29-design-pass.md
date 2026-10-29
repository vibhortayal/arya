# 2026-10-29 · Design pass (owner: "fix all")

Design review with real 390x844 screenshots: https://claude.ai/artifact/YatnaZPEjrKudmXz4MQjGD

## A. Start shopping in one sheet
- Start shopping on a list opens one sheet: Quest or Express. Suggestions the
  list shows get one "Add both/all" line on the sheet.
- The pick skips the bag (pack cards) and the mode screen. A Quest opens
  already playing; Express opens its checklist. Check the list still shows
  when the optimizer has merges, corrections or questions. An empty list
  falls back to the bag. New hunt on the Quest tab is unchanged.
- SW arya-v84. Tests: 1138 OK.

## B. Hunt list: tap a circle to grab
- Each hunt row leads with the List's check circle: tap to grab the whole
  quantity, tap a ticked one to put it back. The row (or its chevron) opens
  the row menu that ••• opened. Only a reported row keeps a button (Found it
  after all). The quantity reads "Pasta 1 lb x2". The big Grab on the card is
  the one orange button.
- SW arya-v85. Tests: 1138 OK. Checked in Chromium: grab, row menu, put back.

## C. Today, calmer
- Your lists moved up under Running low. Still good? folds to one row
  ("Still good? · 2 to check", names under it) that opens the questions.
  "Did you know?" is one line at the foot (× hides it, tap opens Powers).
  "Data through" moved under Your patterns.
- SW arya-v85. Tests: 1139 OK.

## D. One type scale and a consistency sweep
- Font sizes collapse to one scale (34 title, 22 card, 17 row, 15 body,
  13 label, 12 tag, 11 tab) as :root tokens; weights to 400/600/700 (800 for
  display). Scene, HUD and number art left alone.
- "× 1" on list rows is now quiet grey; only real quantities get the chip.
- One back style everywhere: "‹ Back". Quest strips show a shimmer while
  loading (still under reduced motion). Suggestion "why" line wraps cleanly.
- Not done: the demo bar shrink (left as is).
- SW arya-v85. Tests: 1139 OK. Checked Today, Lists and Quest at 390x844.

## Receipts: Needs your eye only when needed (owner, 2026-10-29)
- Heading and card hidden when no line or proposal needs a decision. SW arya-v86.
## Store alerts hide until real (owner, 2026-10-29)
- New users no longer see the SAMPLE "Costco: Oat milk not there" card on Today; the section appears with the first real alert. Quest tab sample kept.
- SW arya-v86.
