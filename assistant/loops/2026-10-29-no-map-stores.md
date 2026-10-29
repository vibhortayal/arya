# 2026-10-29 · No-map stores + Settings rename (owner mockups, approved)

No-map stores. Which stores have aisle pictures now comes from the
server: GET /api/storemap/stores -> {stores: [{store, key, photos,
model, has_pictures}]}. Trader Joe's ships its photo walk and 3D
model; any other store joins once a shopper capture is kept on its
shared map. Both apps read it once (kept on the phone; Trader Joe's
works offline). The hard-coded STORE_PHOTOS / STORE_MODELS tables
in quest.js and web/src/lib/stores.ts are gone.

- Start shopping sheet: a list whose one store has no pictures shows
  Express only, with the approved note ("Quest needs aisle photos of
  this store ... Once {store} is mapped, Quest turns on here.").
- Every other Quest entry for such a store (the mode screen, the
  fastMode "quest" path) runs Express; the mode screen hides Quest.
- Express help row: an item with no data (store pictures AND a shelf
  match, shelf_u) loses Show me and gets the nudge "Arya has no photo
  of this aisle yet. Found it? Snap the aisle so other Arya Shoppers
  can find it too." The Quest hunt's next card carries the same line.
- Snap the aisle: /api/storemap/next?store=&item= always answers. A
  known section asks for that section; otherwise a teach prompt
  (photo, or a short video: new "Record a short video" button on the
  capture screen). The teach upload now takes item= and notes the
  item in the section the reader named. After the capture, "Back to
  shopping" returns to the trip.

Settings rename: the Profile page title is "Settings", its inner
"Settings" section is "Account", the avatar reads "Settings, level N".
Feature sheet updated.

Tests: tests/test_no_map_stores.py (endpoint, snap prompt, teach
with item, both apps' markup, rename); vitest stores.test.ts; e2e
list + express gained Costco checks. SW arya-v96.
