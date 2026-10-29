# 2026-10-29: One store map per location (Trader Joe's)

Owner decision (20:36Z): "Per location, chain as a guess". Each store
location earns its own map; other locations of a chain Arya has walked
play the chain's typical layout, labelled as a guess.

## Before
Maps were keyed by store name, so every Trader Joe's shared the one
shipped walk (filmed at the Trader Joe's on Argonaut) and showed
Mapped.

## Now
- `api/storemap.py`: a map's key is `chain@store_id`. A reference is
  `"name|store_id"`; a bare name means the account's one store of that
  chain in My Stores (none or several: the chain key, as before).
- The walk seeds only its own store: the directory Trader Joe's whose
  street or city says Argonaut, or `ARYA_WALK_STORE_ID`. That store
  takes over the old chain map (walk plus any captures, and their
  pictures). Other Trader Joe's start empty, and `view()` says
  `typical: "Trader Joe's"`.
- `stores_with_pictures` stays keyed by chain (Hunt's photo walk).
- Quest (`appSource.ts`) asks for `name|id`, reports found sections to
  the location's map, and plays an unmapped Trader Joe's as "Typical
  Trader Joe's layout · not mapped here yet", shelf hints worded
  "Usually near the X shelf at Trader Joe's".

## Not changed
- Hunt's photo walk and the 3D peek are still per chain: every
  Trader Joe's shows the Argonaut photos there.
- No Argonaut store in the directory and no env: the walk maps no
  store, and every Trader Joe's is typical.

Tests: test_storemap (+6), test_album/test_teach on the walk ref,
appSource tests (+3), full Python suite 1226, vitest 218, all e2e.
