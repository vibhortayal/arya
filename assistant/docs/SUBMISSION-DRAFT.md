# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT. Nothing is submitted until the owner approves the complete
package. Portal fields sit behind participant sign-in; blocks are written
to be pasted into the matching fields.

## Name

Arya

## Tagline

Arya keeps a living model of your grocery world: every receipt read and
verified, every return netted, every pattern learned — so the list
writes itself.

## What it is

Arya is a grocery assistant. A household uploads receipts (PDF or photo).
Arya reads each receipt with Muse Spark, checks the lines against the
printed total by arithmetic, and builds a ledger of kept purchases.
Deterministic engines learn each item's cadence and price by store, and
derive the shopping list. A fridge photo corrects the model by sight.
A chat agent answers from the model and applies stated facts ("we
finished the yogurt") as validated actions. A prepared cart waits for a
human tap. Nothing buys itself.

## How Meta models are used

- Muse Spark 1.3 (Standard) reads receipt PDFs, receipt photos, and
  fridge photos (vision), and powers the Ask Arya agent.
- Personal data runs in Standard mode only. Contributor mode is used
  only on synthetic or public fixtures in eval loops. This rule is
  enforced in code, not in policy text.
- All math — ledger, returns netting, cadence, spend — is deterministic
  code. The model reads and speaks; it never calculates.
- Measured cost: a receipt decode costs 0.5–3 cents. A household costs
  roughly 20–60 cents a month. The full build ran on the $150 credit
  with a per-day budget guard in the server.

## Evidence

- Gate 0 (photo decode): 93.9% of lines correct (product and paid price)
  across 13 receipts, 130 lines, hand-labeled before decoding; public
  fixtures never entered the owner's ledger.
- PDF corpus: 114 real receipts, 1,226 lines, 114/114 arithmetic match.
- Live at https://arya-pilot.duckdns.org — "Try the demo household" is
  a fictional read-only household; judges need no account.

## Team

Team Nightshift, Indie track. One representative, one builder agent.
