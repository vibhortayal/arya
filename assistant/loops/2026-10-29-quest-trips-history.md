# 2026-10-29: Your trips is history only; Bundles cut

Usability audit (owner approved "rest", 2026-10-29): keep-or-cut calls
1, 2 (album row), 5 and 6, plus the Your trips rows.

## Now
- `screens/Quest.tsx` (Your trips): the trip to resume (Resume, End),
  every other open trip with End (no fold, and the hero is not listed
  twice), and finished trips. Gone from this page: the level band,
  + New quest, Teach Arya your store, Crew (Friends, Shop-Off), the
  server Album row, the Crew feed and Fastest Hands. Their screens keep
  their routes. The profile fetch stays only for the avatar's level ring.
- Map my store stays on the Quest home and in the end-of-trip offer
  (owner rule; coordinator caution).
- `game/ui/Hub.tsx`: the Bundles tile is cut (never explained; Fable's
  review found its matching loose). `Finish.tsx` no longer announces a
  finished bundle. The bundle logic in `core/meta.ts` stays.

## Tests
e2e community (Your trips shows none of the cut rows) and endquest (the
hero is not listed twice). Python source pins updated to the new page.
