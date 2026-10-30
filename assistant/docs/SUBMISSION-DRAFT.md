# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT. Nothing is submitted until the owner approves the complete
package. Portal fields sit behind participant sign-in; blocks are written
to be pasted into the matching fields. The judging map and the package
checklist live in `docs/quest/SUBMISSION.md`; this file holds the copy.

## Name

Arya

## Tagline

Waze for grocery shopping. Arya reads and verifies every receipt, nets out
returns and learns your patterns, so your list writes itself. Quest, its
optional game, turns the weekly shop into a hunt through a model of your
own store.

## What it is

One product, one account. The list comes first; Quest is optional.

Arya does not compete with your list app. It collects from all of them,
through your own assistant, and gives you back one list that writes
itself. The agent connector is a standard MCP server: any
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
names Arya cannot resolve and shows its sources; the user settles. Ask
Arya answers from the model and applies stated facts ("we finished the
yogurt") as server-validated actions. Nothing buys itself. A per-account token also connects the user's
Muse: a forwarded order or a sentence in chat becomes structured
intake that Arya verifies the same way.

Quest is the play layer. The shopper starts a quest from a list, and
Arya opens it at that list's store. A store plays as a labelled typical
layout until shoppers map it: a guided camera scan, where the shopper
pans along the shelves, SAM 3.1 blurs every person, and Muse Spark reads
the sections, aisle signs and prices. Each grab earns points (no clock,
no way to lose). Find it for me points the camera at the shelf: SAM 3.1
boxes candidates, Muse Spark verifies the crop, and the item lights up
for one tap. Arya keeps pictures of products, never of people. Every
grab, sighting and "Not here?" report feeds a live store map. The
receipt photo ends the quest: it banks the points and feeds the brain,
so next week's list writes itself.

## How Meta models are used

- Muse Spark 1.3 (Standard) reads receipt PDFs and list photos
  (vision); is the fallback reader for receipt photos;
  labels store shelves; and powers the Ask Arya agent and the staple
  judge.
- Muse Wonder 1.0 reads receipt photos — the primary photo reader
  (98.98% of lines correct on the Gate 0 public set, against Spark's
  93.88%; price errors 0 against 4). Muse Spark Open (open weights, on Baseten) is the staple
  judge's second seat: it re-judges from item names alone and never sees
  personal data.
- Muse Image paints the collect-celebration characters (Quest mode).
- Muse Voice Transcribe takes voice intake in the app: dictation for
  list adds and voice in Ask Arya.
- SAM 3.1 finds shelves and signs in the guided store scan, boxes items
  for Find it for me, and finds people so they are blurred before any
  frame is kept.
- Personal data runs in Standard mode only. Contributor mode is used
  only on synthetic or public fixtures in eval loops. This rule is
  enforced in code, not in policy text.
- All math — ledger, returns netting, cadence, spend — is deterministic
  code. The model reads and speaks; it never calculates.
- Cost: every model call is written to a cost ledger, and a daily budget
  guard stops app spend. The Wonder proof run over the 9 public receipts
  cost $1.12.

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
- Store maps: earned from shoppers' guided scans. A section counts as
  mapped only with a usable, fresh picture; no store ships mapped.
- Test suite: 1,235 Python tests, green on `main` at #198.
- Live at https://arya.teamnightshift.org — "Try it now" opens a
  fictional household with no account. Judges can play the whole
  loop: list in by typing, photo or voice; a quest from a list; the
  receipt finish; and Ask Arya. Each
  visitor's changes live in a sandbox for that visit only.

## Team

Team Nightshift, Indie track. One representative, one builder agent.
