# 2026-10-29: Remove the old Trader Joe's walk data

Owner decision ("remove the old trader joe data", then "Remove
everything" on the decision card): the walkthrough video's store was
never recorded, so its data could not honestly be any store's map.
Photos, 3D model, walk map and localizer all go; pitch docs reworded.
Everything stays in git history; reverting this one commit restores it.

## Removed
- Data: `pwa/models/trader-joes/` (90 frames, `cloud.bin`,
  `manifest.json`, `shelf-graph.json`, `scrub.json`) and
  `models/trader-joes/` (localizer index and manifest).
- Where am I?: `api/localizer.py`, `api/locate.py`, route
  `POST /api/quest/locate`, the Hunt button and its strings,
  `tools/build_localizer_index.py`, `tools/eval_localizer.py`.
- Walk seed: `walk_location`, `walk_segments`, `typical` in the map
  view, the built-in store row (server and `lib/stores.ts`),
  `ARYA_WALK_STORE_ID`, `harness/scrub_walk_frames.py`.
- Screenshots of the walk: `docs/images/hunt.png`,
  `assistant/docs/img/j-hunt.png`.

## Kept
- Generic code that would serve a new store: the photo and cloud
  scene drivers, `tools/prep_cloud.py`, `tools/build_shelf_graph.py`,
  `api/shelfmatch.py` (inert with no graphs; its tests use an invented
  fixture store, `tests/fixtures/shelf-graphs/sample-market`).
- Shopper captures. `load_map` drops a saved section that only had the
  walk baseline and keeps any section with a capture.

## Behaviour now
- No store ships with pictures. `/api/storemap/stores` lists only
  stores with kept captures, with `captured_at` per location.
- Every store plays Quest as a labelled typical layout and offers
  Express only in the list flow until shoppers map it.
- The demo's store picker no longer hides stores without pictures
  (it would have shown nothing).

## Tests
Python suite green. Vitest 232/232. e2e: mode, store and express specs
updated; analysis, home, item, list and race fail the same way on main
(they need the demo household and the cartqueen user).
