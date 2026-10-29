# 2026-10-29: Map my store, easy to reach

Owner: "where did map my store option go?" and "i would like to have a
map my store option somewhere easy to access", "maybe in ask arya?".
It lived two taps deep (Quest home, Your trips, Teach Arya your store).

## Now
- Quest home: a "Map my store" row above Your trips (`#qm-map-store`).
- A real trip at a store not fully mapped (`QuestGame.needsMap`):
  - a card at the start that only informs ("This store isn't mapped
    yet ... when you're done, you can help map it"), gone on the first
    item handled or when dismissed;
  - one offer at the end: "Map the sections you walked?" on Finish.
  Never mid-trip: leaving the game would lose the trip (the app shows
  one screen at a time). An in-trip "Snap the aisle" waits for the
  guided scan, which can open as a sheet over the game.
- Ask Arya: a "Map my store" chip, and asking in words ("map my store",
  "help me scan this store"; not receipts) answers with a button that
  opens it (`wantsMapStore`, no model call).

Tests: `screens/quest/mapStore.test.ts`, `e2e/mapstore.e2e.mjs`, full
suite, vitest 230, all e2e.
