# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT. Nothing is submitted until the owner approves the complete
package. Portal fields sit behind participant sign-in; blocks are written
to be pasted into the matching fields. The judging map and the package
checklist live in `docs/quest/SUBMISSION.md`; this file holds the copy.

## Name

Arya

## Tagline

A grocery list that learns from your receipts. Arya reads every receipt,
checks each line against the printed total, nets out returns and learns
what your household buys, how often and where, so your list mostly writes
itself. Quest, an optional game, makes the trip itself more fun.

## What it is

One product, one account. The list comes first; Quest is optional.

Arya does not compete with your list app. It collects from all of them,
through your own assistant, and gives you back one list that writes
itself. The agent connector is a standard MCP server: any
MCP-capable assistant connects with your account token to read the
list, add items, and file receipts it has read. Muse Spark is the
showcased client.

The brain keeps the household's model. Receipts enter as PDF or photo.
Muse Spark reads each receipt photo and PDF first; code checks the read,
and Muse Wonder re-reads a photo when Spark fails or the checks flag it;
code then checks the lines against the
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
  (vision); is the first reader for receipt photos;
  labels store shelves; and powers the Ask Arya agent and the staple
  judge.
- Muse Wonder 1.0 is the second reader for receipt photos: it re-reads a
  photo when Spark fails, or when the checks flag the Spark read (the
  lines don't add up, impossible prices, a big price jump, or low
  confidence on too many lines). Read alone on the Gate 0 public set,
  Wonder got 98.98% of lines right against Spark's 93.88%, with 0 price
  errors against 4. Muse Spark Open (open weights, on Baseten) is the staple
  judge's second seat: it re-judges from item names alone and never sees
  personal data.
- Muse Image painted the 20 collect-celebration characters once, during
  the build (they ship as assets), and paints live in the app: a player's
  avatar from a description or their own photo, and the optional paint
  pass on the haul share card.
- Muse Voice Transcribe takes voice intake in the app: dictation for
  list adds and voice in Ask Arya.
- SAM 3.1 finds shelves and signs in the guided store scan, boxes items
  for Find it for me, and finds people so they are blurred before any
  frame is kept.
- Spark runs on Meta's discounted Contributor tier (owner decision
  2026-11-01), so content sent to Spark may be used to train future Meta
  models. Receipt photos are read by Spark first, so they can be used
  for training too; Wonder (the second reader) runs on Standard, which is
  not used for training. A switch (`ARYA_SPARK_TIER=standard`) puts Spark back on
  Standard. A client-side gate keeps Spark under Contributor's 150
  requests a minute.
- All math — ledger, returns netting, cadence, spend — is deterministic
  code. The model reads and speaks; it never calculates.
- Cost: every model call is written to a cost ledger, and a daily budget
  guard stops app spend. The Wonder proof run over the 9 public receipts
  cost $1.12.

## Responsible AI

Arya uses Meta models to read receipts, photos and voice, and to answer questions. AI can be wrong, so Arya never saves a photo or receipt read until you confirm it, marks lines it is unsure about for you to check, and tells you plainly where AI is used (Settings, About Arya, How Arya uses AI). Expiry dates carry a clear warning to check the pack yourself, because food safety is the one place a wrong read could hurt someone. Photos of people are blurred before a store photo is kept, and prices come only from you and other Arya shoppers, never scraped from the web. Arya says plainly (privacy page, How Arya uses AI) that content sent to Muse Spark, such as lists, list and date photos, fridge photos and questions, may be used by Meta to train future models. Receipt photos are read by Muse Spark first too; when Muse Wonder re-reads one, that copy is not used for training.

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
  hand adjudication, with 0 price errors and 7/7 arithmetic.
- Design choice, tested before it was built: Wonder read the Gate 0
  photos best (97 of 98 lines, no price errors, about $0.12 and 34 s a
  receipt) and Spark read them cheaper and faster (about $0.013 and 9 s)
  with 4 price errors that its own confidence did not flag. So the app
  reads with Spark first, checks the read with code (arithmetic,
  impossible prices, price history, too many unsure lines), and calls
  Wonder only when Spark fails or a check fails. This keeps most receipts
  cheap and fast and spends Wonder where it is needed. We have not yet
  measured this combined reader on the Gate 0 photos, so we make no
  accuracy claim for it; every line Arya is unsure about still goes to
  the review queue. Each receipt records which model read it.
- Staple judge: precision 0.79 against a purchase-cadence proxy on
  the owner's 114 receipts. The eval method and the disagreement
  lists are in the research repo.
- PDF corpus: 114 real receipts, 1,226 lines, 114/114 arithmetic match.
- Store maps: earned from shoppers' guided scans. A section counts as
  mapped only with a usable, fresh picture; no store ships mapped.
- Test suite: more than 1,200 Python unit tests plus the web app's
  tests (`cd assistant && python -m unittest discover -s tests`). A small
  number of known failures on `main` are tracked in GitHub issues.
- Live at https://arya.teamnightshift.org — "Try it now" opens a
  fictional household with no account. Judges can play the whole
  loop: list in by typing, photo or voice; a quest from a list; the
  receipt finish; and Ask Arya. Each
  visitor's changes live in a sandbox for that visit only. The step-by-step
  path is `docs/quest/JUDGE-PLAYBOOK.md`.

## Team

Team Nightshift, Indie track. One representative, one builder agent.
