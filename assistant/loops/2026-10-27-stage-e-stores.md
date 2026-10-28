# Stage E — Stores — 2026-10-27 (night)

**Scope.** The owner's store-discovery fix (DISCUSSION entry 29):
stores findable by address or ZIP, favorites starred and surfaced
first, add-a-store takes a full address, more stores findable from
the available quests ("With quests"). Built on the restyled shell;
scene.js, api/models, and the Brain renderers untouched (the one
test edit outside the stage is the brain-restyle SW-cache pin,
v16 -> v17, which the bump necessarily moves).

**Design.** Two planes, per DISCUSSION entry 6 / ARCHITECTURE:
- Directory = platform plane. `stores.json` in the data root,
  read/written with the per-user context cleared (the pattern
  main._is_demo uses for the session store). Rows: id, name,
  street, city, state, zip, scene ("cloud" | "strip"),
  created_by (account id or "seed").
- My Stores = account plane. `my_stores.json` per account:
  [{store_id, favorite, added_at}]. First access initializes it
  with the four seed stores, Trader Joe's + Costco starred — a
  new account starts with the stores its household already shops
  (wireframe S2). Nothing else is auto-added, ever.

**API** (`assistant/api/stores.py`, routes in main.py):
- GET /api/stores/search?q=&quests=1 — digit q matches ZIP by
  prefix (full ZIP = exact-or-prefix); other q is a normalized
  substring match on name/street/city/state; quests=1 keeps
  scene=cloud. Rows carry in_mine + favorite.
- GET /api/stores/mine — favorites first, then name order.
- POST /api/stores/mine {store_id} — idempotent; 404 unknown.
- POST /api/stores {name, street, city, state, zip} — creates
  (scene strip) and adds to mine; dedupe on normalized
  (name, zip): an existing row is returned and added, the new
  street is NOT written over it. ZIP normalized to 5 digits.
- POST /api/stores/favorite {store_id, favorite} — 404 when the
  store is not in the caller's mine (authz by construction:
  favorites live in the caller's own file).
- Demo account: writes are normal writes — 403 from the existing
  middleware; only the two carved live doors stay open.

**Sessions.** quest.create_session gains store_id /
store_address kwargs; the create route resolves store_id via
stores.snapshot() (404 unknown) and the directory name wins over
a typed name. The session keeps "store" as its display string —
hub rows, hunts, reports, Shop-Off all unchanged. Free-text
sessions carry neither new field (back-compat, covered by test).

**PWA** (quest.js, index.html, styles.css; SW arya-v17):
- Pick (view-store): renders My Stores — Favorites section, then
  All my stores; each row: name, "street, city, ST ZIP · scene
  status" ("3D mapped · Quest ready" / "Plays in Strip"), a
  drawn-SVG star on favorites. Tap selects (draft.storeId +
  st-name filled); typing a different name clears the selection
  back to a free-text trip. The old session/spend chips are gone.
- Find (view-stores-find): search field + chips All / With
  quests / Near this ZIP (ZIP prefix area = first three digits of
  the typed ZIP, else the first favorite's). Rows show Add, or
  "Added ✓" when already in mine.
- Mine (view-stores-mine): same sections; the star is a 44 pt
  toggle button (filled = favorite). Find / Add navrows below.
- Add (view-stores-add): name/street/city/state/ZIP form, the
  Strip note, one primary "Add store"; lands on My Stores with
  the new store present.
- Profile (B6) gains a Stores navrow above Analysis.

**Verification.** Suite: 146 green (126 baseline + 20 new in
tests/test_stores.py; unittest-style under pytest). node --check
on quest.js clean. Live-serve smoke (uvicorn, scratch data):
setup -> mine returns favorites-first seeds; search?q=91709
&quests=1 returns Trader Joe's only; a store_id session carries
the snapshot address "13911 Peyton Dr, Chino Hills, CA 91709";
the shell serves all three new views.

**Costs.** $0 — deterministic code, no model calls.

**Gaps / next.** No geocoding or distance sort (ZIP-prefix area
stands in for "near"); no remove-from-mine, no directory edit or
delete; Shop-Off create still free-text; the demo household's My
Stores is the seed set (its writes stay blocked). Deploy is the
parent's step (git pull on the VM).
