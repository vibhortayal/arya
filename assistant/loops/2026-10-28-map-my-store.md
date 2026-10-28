# 2026-10-28 — Map my store (guided, crowd-built store map)

Owner asked for a guided mapper instead of "take a photo or record a
video". Built on PR #18 (branch feat/map-my-store, base feat/game-shell).

- `api/storemap.py`: segments, coverage status, capture grading with
  one-line retake fixes, best-capture selection (score x freshness,
  near-duplicate = confirmation), prompts, stale flags, per-account focus.
- Routes `/api/storemap/*`; capture route scrubs people with SAM first
  (fails closed), grades before any model call. "Not here" report now
  returns `map_task`. `record_sightings` feeds `note_sighting`.
- PWA: Map my store + guided capture screens (`mapper.js`), Today row,
  walk video sampled on the phone (sharpest 6 of 12 frames sent).
- Docs: `docs/quest/MAP-MY-STORE.md`, `docs/quest/map-my-store-wireframe.html`.
- Tests: `tests/test_storemap.py` (20). Full suite green.
- Model cost per upload: two SAM people calls plus one SAM shelf call,
  about $0.0075; a refused weak frame costs $0.
- Next: split long aisles, Spark item labels from captures, rewards.
