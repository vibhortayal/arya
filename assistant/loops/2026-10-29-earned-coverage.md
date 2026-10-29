# 2026-10-29: Quest store status is earned (Trader Joe's showed "part mapped")

Owner: "why is Trader Joe's (Argonaut) showing part mapped" and "Arya
engine should be smart, it shouldn't map something just because user
uploaded a video and call it partially mapped".

## Causes
1. The shipped walk's photos were picked by the stop's frame number,
   but the shipped frames are a thinned copy (90 of ~180). Stops past
   frame 90 had no picture, the rest pointed at the wrong frame.
2. Store-map labels were read against a fixed list, and many of the
   walk's own labels (Canned Goods, Condiments, Personal Care) matched
   nothing, so a fully walked store fell short of "every section".
3. The status only asked "is any segment mapped or aging", so a stray
   upload or a weak shot could make a store "part mapped".

## Fix
- `api/storemap.py`: walk frames come from the stop's path fraction
  (the same rule as the photo driver); a saved map takes the corrected
  frame on load. New `located(seg)`: a segment counts only with a
  usable, non-stale picture (a non-weak shopper capture, or a walk
  frame). `view()` rows carry `located`.
- `web/src/screens/quest/appSource.ts` `coverageOf()`: located segments
  read as sections (wider label words). Mapped = 8 of 10 sections
  located; part mapped = 3 to 7; fewer is simulated. A mapped store's
  unlocated section is a labelled guess, not fog.
- Trader Joe's walk: 26 of 26 segments located, 9 of 10 sections ->
  Mapped (meat was not on the walk; it shows as a guess).

## Not changed
- Store maps are keyed by store name, so every Trader Joe's shares the
  Argonaut walk. Per-location maps need a store-id key; left for the
  owner to call.

Tests: test_storemap (+4), appSource tests (rule, TJ labels), full
Python suite, vitest 211, all e2e specs.
