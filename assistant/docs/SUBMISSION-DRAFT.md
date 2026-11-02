# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT, checked 2026-11-01 against main 0d0b0f2, the live site and
the video claim check (`/mnt/project-files/demo-video/03-CLAIM-CHECK.md`).
Nothing is submitted until the owner approves the complete package. Portal
fields sit behind participant sign-in, so the blocks below follow common
portal fields; paste each into the field that matches. The judging map and
the package checklist live in `docs/quest/SUBMISSION.md`.

Wording rules for this file: list first, Quest optional; nothing unbuilt
is described as built; no lines about model training (owner, 2026-11-01).

## Project name

Arya

## Tagline (one line)

A grocery list that learns how you shop, from your own receipts.

## Short description (about 50 words)

Arya reads your grocery receipts, checks every line against the printed
total, and learns what your household buys, how often and where. Your list
then mostly writes itself. Add items by typing, voice or a photo of a note,
ask Arya questions, and, if you like, turn the trip into a game.

## Problem

Groceries are one of a household's biggest weekly costs in money and
time, and we all manage them in pieces: notes, texts and one app per
store. None of it connects. Food goes bad, staples run out before anyone
notices, and nobody knows where the money went. Your receipts already
hold the truth about what you buy, but nobody reads them.

## What it does

- **Learns from receipts.** A receipt goes in as a photo, a PDF or a
  store-app export. Arya reads it, checks each line against the printed
  total, nets out returns and keeps items bought for others out of your
  patterns.
- **The list writes itself.** Plain code learns each item's cadence and
  price by store. Today shows what is running low and why ("about every
  7 days, last bought 10 days ago"), what to use soon, and one list per
  store with suggestions you tap to accept.
- **Add any way.** Type, say it, or snap a handwritten list.
- **Ask Arya.** "What did we spend on coffee?" is answered from your own
  data. "We finished the Greek yogurt" puts it on the list, through an
  action the server checks first.
- **Quest (optional).** Start shopping turns the list into a walk through
  your store. Find it for me points the camera at a shelf and lights up
  the item. Not here? warns the next shopper. A guided scan lets shoppers
  map their store, with every person blurred first.
- **Open to other apps.** A developer portal (/developers) with an open
  Lists API, per-account tokens and a standard MCP connector, so an
  MCP-capable assistant can read the list and add to it.

## How Meta models are used

- **Muse Spark 1.3** (Standard mode): the first reader for receipt photos
  and PDFs; reads list photos and expands receipt abbreviations; labels
  shelves in the store scan; runs Ask Arya; and is the staple judge that
  decides which items may be suggested.
- **Muse Wonder 1.0**: the second reader for receipt photos. Code checks
  every Spark read (the lines add up, subtotal plus tax equals the total,
  no impossible prices or big price jumps, not too many unsure lines).
  Wonder re-reads only a receipt that fails a check, or one Spark could
  not read. Each receipt records which model read it.
- **Muse Spark Open** (open weights, hosted on Baseten): the staple judge's second
  seat. It judges again from item names alone and never sees personal data.
- **SAM 3.1**: finds shelves and signs in the guided store scan, boxes
  candidates for Find it for me (Spark then checks each crop), and finds
  people so they are blurred before any frame is kept.
- **Muse Voice Transcribe**: voice adds in lists and voice questions in Ask.
- **Muse Image**: painted the 20 Quest celebration characters once during
  the build, and paints live in the app (a player's avatar, and the
  optional paint pass on the trip share card).
- **Meta Model API**: one client module (`assistant/api/meta_client.py`)
  makes every call, writes each to a cost ledger, and a daily budget guard
  stops spend.
- All math (ledger, returns, cadence, spend, price compare) is plain code.
  The models read and speak; they never calculate.

## How we built it

Python (FastAPI) backend with deterministic engines for the ledger,
patterns and lists; a React + TypeScript PWA; in-process demo sandboxes;
Supabase for email sign-in codes; one Oracle VM with Docker Compose. Every line of
product code was written during the hackathon window (first commit
Oct 27, 2026, 15:13 ET); see "How this was built" in the README.

## Challenges

- **Reading receipts you can trust.** In our test on 9 public receipts
  (98 lines, labeled by hand first), Wonder got 97 lines right with 0 price
  errors; Spark got 92 with 4 price errors its own confidence did not
  flag, at about a tenth of the cost and a quarter of the time. So Spark
  reads first, code checks the arithmetic, and Wonder takes a second look
  only when a check fails. This combined reader is not yet measured on
  those photos, so we claim no accuracy number for it; unsure lines always
  go to a review queue.
- **Patterns, not prompts.** A model guessing "you need milk" is easy to
  build and hard to trust. Cadence and price are code; the model only
  judges which items are staples, and a second open-weights model checks it.
- **Privacy in the store.** No picture of a person is kept: SAM finds
  people and blurs them before a store frame is saved, and the scan fails
  closed.

## Accomplishments and evidence

- 114 of the owner's own Costco receipts (three years, 1,226 lines) came
  in as the Costco app's export; code parsed them and 114 of 114 add up to
  the printed total. Muse Spark expanded the abbreviated names.
- Staple judge: precision 0.79 against a purchase-cadence proxy on those
  114 receipts. Muse Spark Open and hosted Spark agreed on all 32 test
  names for category and section.
- Receipt photo test (9 public receipts, 98 lines): Wonder 97/98, 0 price
  errors; Spark 92/98, 4 price errors. Public test receipts never entered
  the owner's data.
- More than 1,200 Python unit tests plus the web app's tests. A small
  number of known failures on `main` are tracked in GitHub issues.

## Responsible AI

AI can be wrong, so Arya never saves a photo or receipt read until you
confirm it, marks the lines it is unsure about, and says plainly where AI
is used (Settings, About Arya, How Arya uses AI). Expiry dates carry a
warning to check the pack, because food safety is where a wrong read
could hurt. No picture of a person is kept. Prices come only from your
own receipts and lists and from other Arya shoppers, never scraped from
store sites or the web.

## What's next

Open sign-ups; prices and store news shared by Arya shoppers; whole-store
maps; and the same shelf-reading on Meta glasses, hands free. None of
these is built yet beyond what is listed above.

## Known limits

Testing data is limited to one household, and limited data was available.
Real-device testing was done only on an iPhone 17 Pro. Other phone sizes were
checked in a browser at 360x640, 390x844, 430x932 and 390x568.

## Try it

- Live: https://arya.teamnightshift.org. Tap "Try it now" for a fictional
  household with no account. Each visitor's changes stay in a sandbox for
  that visit only. Sign-up is invite only during judging.
- Judge path (about 8 minutes): `docs/quest/JUDGE-PLAYBOOK.md`.
- Repo: https://github.com/vibhortayal/arya
- Video: (owner adds the link)

## Track and team

Indie track. Team Nightshift: Vibhor Tayal (representative and only
member), building with Claude Code as the coding agent.
