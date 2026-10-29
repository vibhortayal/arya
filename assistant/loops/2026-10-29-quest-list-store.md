# 2026-10-29: A list for a store goes to that store

Usability audit, pain point 4. Start shopping on a Trader Joe's list
still asked "Where are you shopping?", and the picker's first rows were
headed "Near you" though they are the user's own stores.

## Now
- `ShoppingList.store` (game type): a named list's first store.
  `appSource.lists()` fills it.
- `QuestGame`: Start on a list with a store resolves it (the player's
  stores by name first, then search) and opens the trip there; no match
  falls back to the store pick. Arriving from the Lists tab with that
  list (a returning player) goes straight into the trip. First-timers
  still see the practice card first.
- `Hub.Home`: "Start at <store>" plus "Shop somewhere else" (the pick).
- `Hub.Pick`: the list's store leads; the heading reads "Your stores".

## Tests
`e2e/liststore.e2e.mjs`. Full e2e (with the demo household seeded) and
the Python suite pass.
