# 2026-10-29 — The in-store screen, less cluttered

Usability audit pains 8 and 9; owner approved the mockup (artifact
Rc5gDRWe91gfny6ipNwXrQ) at 00:07Z on 2026-10-30.

Before: the header carried the store name with a kind badge, a "Typical
layout · not mapped here yet" pill, a "Whole store" pill, and a card
saying "This store isn't mapped yet... you can help map it" with no way
to do it. The dock had Route and List, two sheets for one list.

Now (game/ui/Play.tsx):
- Header: back, store name, cart and points, help. One row.
- One cue under it: "Typical layout" (simulated), "Part mapped" or
  "Practice"; none for a mapped store. On a real trip where the host
  offers Map my store, it reads "· Map it ›" and opens a sheet: Map it
  now (ends a trip with grabs, which stay checked off; an empty trip was
  never saved), After this trip (Finish already offers it), Keep playing.
  The start-of-trip card is gone. Map my store stays on the Quest home
  and in the end-of-trip offer (coordinator caution).
- Whole store: a small map button above the dock (pressed = follow me).
- One List sheet: add field at the top, sections numbered in walking
  order with Go, items under each. "Change the order or skip a section"
  opens the old route editor in place (move, skip, Use Arya's order, Done).
- Empty list: the dock says "Your list is empty" with an add field and
  "Pick a saved list" (back to the Quest home's list picker), instead of
  "Everything on your list is decided" and Head to checkout. No mission
  card for an empty trip.

Tests: src/game/ui/Play.test.tsx (empty dock, no Route, Map it only with
a host map); e2e/instore.e2e.mjs (one cue, Map it sheet, List sheet add,
numbering, reorder/skip, Go).
