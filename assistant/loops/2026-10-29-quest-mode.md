# 2026-10-29 · Quest mode, part 1: the game is the Quest tab

What changed
- The Quest game from the spike (#166: React Three Fiber world, choose
  before you grab, quiet real-store mode) now lives in the app under
  `web/src/game`, lazy-loaded (the 3D chunk loads only on a trip).
- `screens/quest/appSource.ts` feeds it real data: lists from the plan,
  stores from Your stores and search, store kind from the shared store
  map (fresh sightings only; nobody mapped = simulated), and a hunt
  session per real trip (grab -> check, Not here -> report-missing,
  Found it in fog -> store-map segment, finish -> state finished).
- `screens/quest/QuestMode.tsx` hosts it: home above the tab bar, a
  trip full screen, Add your receipt opens the app's Finish screen.
- Lists "Start shopping" opens Quest on that list. Express removed from
  the sheet; the old hub is now "Your trips". No stock emoji in the game.
- Tests: appSource + 3D walk (vitest), e2e community/list/home updated,
  Python static tests updated for #158. Full suite: 1196 Python OK,
  vitest OK, all e2e OK (friends/race need the second account).

No model spend.

Next
- StoreGraph + layout solver (one store model for Play, Build and the
  community map), Spark zone classification for list items, then Build:
  three questions -> a whole store saved as My map.
