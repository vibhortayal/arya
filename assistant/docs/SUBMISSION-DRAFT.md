# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT. Nothing is submitted until the owner approves the complete
package. Portal fields sit behind participant sign-in; blocks are written
to be pasted into the matching fields. The judging map and the package
checklist live in `docs/quest/SUBMISSION.md`; this file holds the copy.

## Name

Arya

## Tagline

Arya keeps a living model of your grocery world: every receipt read and
verified, every return netted, every pattern learned — so the list
writes itself. Quest, its play layer, turns the weekly shop into a
treasure hunt in your own store — a photo-walk of its real aisles,
with the 3D model one tap away.

## What it is

One product, two layers, one account.

The brain keeps the household's model. Receipts enter as PDF or photo.
Muse Wonder reads each receipt photo (Muse Spark reads PDFs and is
the photo fallback); code checks the lines against the
printed total by arithmetic and builds a ledger of kept purchases —
returns netted, bought-for-others tracked but never suggested.
Deterministic engines learn each item's cadence and price by store and
derive the shopping list; a Muse Spark staple judge gates what the
pattern facts may suggest. The Curator proposes product merges and
splits and applies nothing until the user taps. The Resolver researches
names Arya cannot resolve and shows its sources; the user settles. A
fridge photo corrects the model by sight, after user confirmation. Ask
Arya answers from the model and applies stated facts ("we finished the
yogurt") as server-validated actions. A prepared cart waits for a human
tap. Nothing buys itself. A per-account token also connects the user's
Muse: a forwarded order or a sentence in chat becomes structured
intake that Arya verifies the same way.

Quest is the play layer. The shopper picks a store from a shared
directory — search by name, address, or ZIP; favorites first; a store
can be added with its address. A mapped store is modeled from a
shopper's walkthrough video: the hunt plays over the walk's own
frames (the photo-walk, the default view), and VGGT builds a 3D
point cloud from the same video, one tap away. SAM 3.1 segments
the shelves, Muse Spark labels them, and hunt stops sit at each
item's matched shelf. Quest mode plays the list as a treasure
hunt along that walk; Express mode shows the fastest route. The
receipt photo ends the hunt: it scores the haul, settles Shop-Off
races by receipt timestamp, and feeds the brain, so next week's list —
and next week's hunt — load themselves. A store nobody has mapped
plays on a flat view and is mapped by its own shoppers.

## How Meta models are used

- Muse Spark 1.3 (Standard) reads receipt PDFs, list photos, and
  fridge photos (vision); is the fallback reader for receipt photos;
  labels store shelves; and powers the Ask Arya agent and the staple
  judge.
- Muse Wonder 1.0 reads receipt photos — the primary photo reader
  (98.98% of lines correct on the Gate 0 public set, against Spark's
  93.88%; price errors 0 against 4). Wonder also authored the hunt's
  localizer (the "Where am I?" matcher: 42 of 45 held-out photos at
  the right stop, 45 of 45 in the right neighborhood).
- Muse Image paints the collect-celebration characters (Quest mode).
- Muse Voice Transcribe takes voice intake in the app: dictation for
  list adds and voice in Ask Arya.
- SAM 3.1 segments shelves in walkthrough frames; the segments become
  the store's shelf graph.
- VGGT (Meta AI + Oxford) builds 3D geometry and the camera path from
  walkthrough video. It runs on Modal; its output ships as a web asset.
- Personal data runs in Standard mode only. Contributor mode is used
  only on synthetic or public fixtures in eval loops. This rule is
  enforced in code, not in policy text.
- All math — ledger, returns netting, cadence, spend — is deterministic
  code. The model reads and speaks; it never calculates.
- Measured cost: a receipt decode costs 0.5–3 cents. A household costs
  roughly 20–60 cents a month. The full build ran on the $150 credit
  with a per-day budget guard in the server.

## Evidence

- Gate 0 (photo decode), hand-labeled before decoding: public set
  91.84% of lines correct (product identity + paid price), 90/98 lines
  across 9 public receipts; owner subset 32/32 lines; combined 93.85%
  (122/130). Strict-string accuracy is 81.6% — abbreviation expansions
  count as misses there. Arithmetic reconciled on 7/7 receipts. One
  silent price rotation in the public set got through; it is disclosed
  here and in STATUS.md, and the review queue is the mitigation.
  Public fixtures never entered the owner's ledger.
- Wonder, production proof: the same Gate 0 public set through the
  live production path scored 97 of 98 lines (identity + price) after
  hand adjudication, with 0 price errors and 7/7 arithmetic. Wonder
  reads receipt photos in the app until Nov 4 (MODEL-POLICY amendment);
  Spark is the automatic fallback on any failure.
- Staple judge: precision 0.79 against a purchase-cadence proxy on
  the owner's 114 receipts. The eval method and the disagreement
  lists are in the research repo.
- PDF corpus: 114 real receipts, 1,226 lines, 114/114 arithmetic match.
- Store model: one Trader Joe's stretch (Chino Hills, CA) rebuilt from
  a walkthrough video — a 373,630-point web asset and an 18-stop shelf
  graph (SAM 3.1 segments, Spark labels), live in the app.
- Test suite: 317 tests, green.
- Live at https://arya-pilot.duckdns.org — "Try the demo household" is
  a fictional household; its photo and voice doors call the Meta API
  live and keep nothing, and every other write is refused. Judges need
  no account.

## Team

Team Nightshift, Indie track. One representative, one builder agent.
