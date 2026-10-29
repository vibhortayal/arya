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

## Part 2: one store model (StoreGraph + solver)
- `web/src/game/map/`: `graph.ts` (zones placed by band and order, never
  tiles; `problems()` validates model output), `solve.ts` (graph -> plan,
  deterministic; the old hand-placed template is rebuilt within 1 unit),
  `classify.ts` (store's own words, then template kind, then first aisle),
  `presets.ts` (supermarket, warehouse club, corner store, health food,
  Indian grocer: the starting points for Build).
- 3D fixtures, walk grid, item spots, signs and route order now derive
  from the layout's bands, so any graph renders and walks. Dead 2D route
  helpers removed. Lab has Costco (warehouse) and Patel Brothers (Indian).
- Tests: every preset solves, nothing overlaps, every item has an open
  spot reachable from the doors, one walk covers every zone with cold last.

## Part 3: Arya files unknown items; substitutes keep their name
- `POST /api/quest/zones` (`api/questmap.py`): items the game's words do
  not know go to one Spark structured-output call (Standard, personal)
  with the store's zones; answers cached per account by graph and item.
  No key, over budget, a failed call or unknown zone ids: word guesses
  stand, nothing raises. Not live-tested here (no key in this session).
- Substitute: the grab keeps "what you took instead" (trip.subs, the
  session item's `instead`), shown on the finish card as "Swapped".
- Real trips are calmer: no strolling shoppers outside practice, DPR
  capped at 1.5.

## Part 4: Build (three answers -> a whole store -> My map)
- Quest home has Play | Build. Build: "Draw my store" (a store you shop
  at; its type guessed from the name) or "Dream store" (named, played
  only as practice). Three questions: store type (presets, a cuisine, or
  one kind of food), look (market, modern, farm, neon), what should be
  big (+ an optional sentence). Text answers have a mic (Voice Transcribe
  via `/api/transcribe`).
- `map/answers.ts` `fromAnswers()`: deterministic store from the answers;
  always valid (falls back to the base preset). Then `POST /api/quest/build`
  (`api/questbuild.py`): one Spark structured call adapts it; output is
  checked by a Python port of `problems()`; bad output -> the base stands.
  `POST /api/quest/build/change`: one change said in a sentence, same check.
- Saved maps: `GET/PUT /api/quest/maps`, per account, 20 max, keys
  `store:<id>` / `dream:<slug>`. A saved My map replaces the shared map for
  that player: the store pick says "Your map", the trip uses its zones.
- Looks recolour the 3D store. Walked built stores show their own name.
- Cut for Nov 4 (kept in #170): grid editor, map versions/revert,
  corroboration, dream-store sharing, postcards.
- Tests: `tests/test_quest_build.py` (11), `map/answers.test.ts`,
  AppSource Build tests, `e2e/build.e2e.mjs`. Full Python suite 1212 OK,
  vitest 203 pass, all 35 e2e specs pass. Spark path not live-tested
  (no key in this session).
