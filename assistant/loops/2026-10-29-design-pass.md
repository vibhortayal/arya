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
