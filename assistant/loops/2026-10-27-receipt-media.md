# Receipt image retention (2026-10-27)

Discussion 42. The owner asked: "will my receipt images be
available in the app?" The verified answer was no —
/decode/photo sent the image to the model and
state.add_receipts persisted only the decoded lines; the
photo was discarded after decode (same for /decode/pdf).
Now it is kept.

## What shipped

- **Retention lives in the filing path.** `state.add_receipts`
  accepts `media={receipt_id: (bytes, media_type)}`. The two
  routes that file an uploaded original pass it —
  /decode/photo (the upload's own media type) and /decode/pdf
  (application/pdf) — so every door that files an uploaded
  original keeps it, including the Finish flow's late-upload
  attach (Discussion 41), which files through /decode/photo.
  Text doors, JSON imports, and the seeded history file
  without an upload and keep nothing — those receipts have
  no original, and none is invented.
- **Storage.** Per account: `users/<user>/receipt-media/
  <receipt_id>`, the bytes exactly as uploaded (no
  recompression in v1), the media type recorded on the
  receipt record next to `image_ref` (the field social.py
  already carried for this day). Same auth boundary as the
  receipt data itself — the media lives inside the account's
  own data directory.
- **Serving.** GET /api/quest/receipts/{id}/original returns
  the account's own original at its recorded media type,
  inline. The lookup runs over the caller's receipts (no
  cross-account access — another account gets 404, as does
  the receipt detail), the media reader refuses any id with
  a path separator, and a receipt with no kept original 404s
  honestly. The demo files nothing (unchanged): no media
  directory, no originals.
- **UI.** The receipt detail gains "View receipt" when — and
  only when — an original exists: for an image, a button
  reveals the photo inline; for a PDF, a link opens it at
  its own type. The archive summary now also carries
  media_type alongside the existing photo field.
- **Size.** This is per-receipt storage, not a media
  library. Observed: the test photo (900×1400 solid JPEG)
  is ~10 KB; real receipt photos — large flat areas, phone
  resolution — run a few hundred KB each (the photo-walk's
  real-photo web tier is ~190 KB per 1600×900 frame); the
  unchanged 12 MB upload cap is the hard bound per receipt.
  A household filing a receipt a day adds on the order of
  100 MB a year at the outside — VM disk is not a concern at
  this scale, and no cleanup policy is needed for v1.

## Tests

Suite: **253 green** (6 new in tests/test_receipt_media.py):
photo-filed receipt retains its exact bytes and serves them
to its owner at image/jpeg, on disk under the account's
receipt-media/; PDF likewise at application/pdf (the repo's
fixture PDF, byte-identical); a seeded receipt has no
original (detail photo is null, endpoint 404s, unknown id
404s); a second account cannot read the first's original or
detail; the demo household has no originals and no media
directory; the detail-view viewer is pinned to the
original's existence. SW cache **arya-v28**. **Not pushed,
not deployed** — parent reviews and ships.
