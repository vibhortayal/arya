# 2026-10-29: Guided store scan (Map my store by panning)

Owner: "arya can open a guided camera that can keep telling user if
they are doing good, keep telling what it identified", "use sam3.1",
"user should not be made to click pictures, user just keeps panning",
"this is how panorama and 360 photos are captured ... show some nice
graphics as the app is scanning", "ignoring humans", "capture store
signage, aisle numbers, prices". Mockup approved ("go"):
artifact 16Ts4VVt18kVGt81mBiJwc.

## How it works
- The teach walk (Map my store, Start the walk) is now a live scan.
  The phone grades every frame (sharp, steady, light; no network) and
  sends the sharpest one about every 4 s to `POST /api/storemap/scan`.
- Server (`api/storescan.py`): SAM 3.1 finds people first and they are
  pixelated (`shelfscan.scrub_people_boxes`); the scrub fails closed.
  People over 35% of the frame: paused, not read, not kept. Spark
  reads the scrubbed frame: section, aisle sign, items, and shelf
  prices only with the opt-in. SAM outlines shelves (and the sign when
  one was read). The frame lands on the map like a teach capture.
- Prices: opt-in checkbox; only `sure` reads tied to a named item;
  saved per account in `shelf_prices.json` as the user's own prices
  (source "shelf tag"). No community sharing yet.
- Cap: `ARYA_SCAN_DAILY_FRAMES` (default 120 a day per account, about
  ten 45 s walks; 429 after). Estimated cost about $0.05 a walk
  (3 to 4 SAM images + one Spark read a frame); not yet live-measured.
- Screen: sweep bar (fills with kept frames, full at 10, then stops by
  itself), scan grid and line (off with reduced motion), outlines only
  from SAM's boxes, fading after 3 s since the read lags the view.
  Done shows sections (each removable), signs read, prices, people
  blurred. If live reads fail twice, Done falls back to the old
  end-of-walk send.

## Not yet
- Live cost check with a real key.
- In-trip "Snap the aisle" from Quest (needs the scan as a sheet over
  the game, so the trip is not lost).
- Community price median from opted-in households.

Tests: `tests/test_storescan.py` (10), `screens/scanBox.test.ts`,
`e2e/scan.e2e.mjs`, full suite, vitest, all e2e.
