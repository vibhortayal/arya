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

Arya does not compete with your list app — it collects from all of
them, through your own assistant, and gives you back one list that
writes itself. The agent connector is a standard MCP server: any
MCP-capable assistant connects with your account token to read the
list, add items, and file receipts it has read. Muse Spark is the
showcased client.

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

Quest is the play layer. The shopper picks a store, and Arya sorts
the list by where each item is usually bought, from the receipts. A
mapped store plays over real photos from a shopper's walkthrough
video, with a VGGT point cloud as a 3D peek; any other store plays as
shelf cards. Each grab earns points (no clock, no way to lose). Find
it for me points the camera at the shelf: SAM 3.1 boxes candidates,
Muse Spark verifies the crop, and the item lights up for one tap.
SAM also finds every person in a frame so they are blurred before
anything is kept: Arya keeps pictures of products, never of people.
Every grab, sighting and "Not here?" report feeds a live store map.
The receipt photo ends the hunt: it banks the points, settles Shop-Off
races by receipt timestamp, and feeds the brain, so next week's list
writes itself.

## How Meta models are used

- Muse Spark 1.3 (Standard) reads receipt PDFs, list photos, and
  fridge photos (vision); is the fallback reader for receipt photos;
  labels store shelves; and powers the Ask Arya agent and the staple
  judge.
- Muse Wonder 1.0 reads receipt photos — the primary photo reader
  (98.98% of lines correct on the Gate 0 public set, against Spark's
  93.88%; price errors 0 against 4). Wonder also authored the hunt's
  localizer (the "Where am I?" matcher: 42 of 45 held-out frames from
  the mapping video at the right stop, 45 of 45 in the right
  neighborhood; not yet measured on fresh shopper photos).
- Muse Image paints the collect-celebration characters (Quest mode).
- Muse Voice Transcribe takes voice intake in the app: dictation for
  list adds and voice in Ask Arya.
- SAM 3.1 segments shelves in walkthrough frames (the store's shelf
  graph), boxes items for Shelf Scan and Find it for me, and finds
  people so they are blurred before any frame is kept.
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
- Test suite: 336 tests, green.
- Live at https://arya-pilot.duckdns.org — "Try the demo" opens a
  fictional household with no account. Judges can play the whole
  loop: list in by typing, photo or voice; the Trader Joe's hunt in
  every mode and view; the receipt finish; and Ask Arya. Each
  visitor's changes live in a sandbox for that visit only.

## Team

Team Nightshift, Indie track. One representative, one builder agent.
