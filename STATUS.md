# STATUS — where Arya stands (2026-10-28)

Live: https://arya-pilot.duckdns.org. Deadline: Nov 4, 2026, 9:00 PM ET.
The build record per session lives in `assistant/loops/`; decisions
live in `docs/quest/DISCUSSION.md`. This page says only what is true now.

## Built and deployed (main)
- **Brain:** intake (photo, PDF, JSON, order text, voice, Muse
  connector), ledger with returns netted, patterns, the staple judge,
  the smart list with a store lens, Eyes, Ask Arya, Receipts with the
  original image kept, Analysis (Spend).
- **Quest:** sessions, the Optimizer, Quest and Express hunts, receipt
  finish and Score, Shop-Off (single account), friends and badges,
  Spotter "Not here?" reports, the stores directory, item-to-shelf
  matching, Shelf Scan (SAM 3.1 + Spark verify), Where am I? (the
  local localizer), photo-walk view of Trader Joe's.
- **Demo:** a fictional household in a per-visitor sandbox; demo
  writes never reach disk. Light mode only.
- **Hunt v2** (PR #16, merged): one-column hunt, put back in place,
  nothing auto-finishes, Back is a stack, Finish closes the hunt.

## PR #18 (game shell): merged and deployed 2026-10-28
- Installable PWA (manifest, icons, offline grabs that sync later).
- No clock, no lives: +10 a grab, +25 full haul, +50 receipt; levels;
  milestones, confetti, opt-in sound and buzz.
- How to play on the first hunt; one automatic store view (photos or
  shelf cards) with a 3D peek.
- Find it for me: the camera scans for the next item; tap to grab.
  Verified sightings feed the map. Frames are kept as fresh shelf
  photos only after SAM blurs every person in them.
- Plan a hunt: store first, the list sorted by where each item is
  usually bought, list management in the same screen.
- Wireframes (`docs/quest/wireframes.html`) and the tap-through
  prototype (`docs/quest/game-flow-prototype.html`) match the build.
- Suite: 382 green. Service worker arya-v42.

**Owner steps after merging PR #18:** deploy (`git pull` on the VM);
`python -m harness.make_demo_household data` (the demo gains Costco
trips); `MODEL_API_KEY=… python -m harness.scrub_walk_frames` (blurs
shoppers in the 90 walk photos, about $0.45). Git history still holds
the unblurred originals.

## Measured results
- Gate 0 photo decode: PASS. Public 91.84% (90/98 lines), owner
  32/32, combined 93.85%, arithmetic 7/7. One silent price rotation
  recorded; the review queue is the mitigation.
- Photo decode reads with Muse Wonder 1.0 (90 s bound, Spark
  fallback) under the hackathon amendment, which **expires Nov 4,
  2026**. Proof run 97/98 after adjudication, $1.12.
- Localizer: stop accuracy 42/45, neighborhood 45/45, ~1 s a query.
- Shelf graph build: $0.24 (SAM 36 images + Spark 55 calls).

## Remaining for submission
- Owner phone pass on PR #18, then merge and deploy.
- Demo video and the final submission package (owner go-ahead).
- Public flip of this repo with the submission freeze (Discussion 28),
  after the pre-flip scrub (VM internals out of docs, secrets grep).

## Known gaps
- Store news and the Friends/Store/Global boards read this account only; cross-account data shows labelled samples.
- Split the list (kids or partner) is not built.
- Friend run notifications: designed (Discussion 24), not built.
- Shop-Off and Spotter reports are single-account.
- Deferred: stale-staple curation (M8), /health receipt count (M11),
  deny-by-default route guard (L12).
- Photo opt-in and privacy policy: after the hackathon (owner).

## Owner data (not in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines) are staged
in the Hatch workspace `meta-hackathon-2026/imports/costco-json/`.
Raw files stay out of git.

## Open: phone-pass batch PR (fix/phone-pass-batch) — awaiting owner review
- Seven owner phone-pass fixes in one PR: store-picker tap-to-advance
  + receipts fold, skippable Check-the-list, character popups off,
  receipt-sheet button layout, Add folded into List (four tabs),
  New session on top of Today, compact staples line. SW arya-v43.
- Known pre-existing failure on main: test_photo_driver frame budgets
  (the scrub commit pushed the walk frames over the size guide).
