# Submission draft — Cerebral Valley portal (paste-ready blocks)

Status: DRAFT, checked 2026-11-01 against main 0d0b0f2, the live site and
the video claim check (`/mnt/project-files/demo-video/03-CLAIM-CHECK.md`).
Nothing is submitted until I approve the complete package. Portal
fields sit behind participant sign-in, so the blocks below follow common
portal fields; paste each into the field that matches. The judging map and
the package checklist live in `docs/quest/SUBMISSION.md`.

Wording rules for this file: list first, Quest optional; nothing unbuilt
is described as built; no lines about model training (me, 2026-11-01).

## Project name

Arya

## Tagline (one line)

Arya learns how you shop from your receipts and helps shoppers help each other.

## Short description (about 50 words)

Arya reads your grocery receipts, checks every line against the printed
total, and learns what your household buys, how often and where. Arya
then suggests what is running low and what to use soon. Add items by typing, voice or a photo of a note,
ask Arya questions, and, if you like, turn the trip into a game.

## Build for Your World

- **What is Arya.** A grocery app that learns from your receipts and helps shoppers help each other; the full story is in the README.
- **Why I built it.** I had this problem: carrying the list in my
  head and not knowing where the money went. Arya frees up that time and
  mental space. Arya is free to use; households and groups share lists. It costs money to keep running (the AI
  reading), and you can see what you use in Settings, About Arya, Keeping
  Arya running. See `docs/PRINCIPLES.md`.
- **What it uses.** Meta's models: Muse Spark, Muse Wonder, SAM 3.1, Muse Voice
  Transcribe, Muse Image and Muse Spark Open, each with one job.

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
- **Suggestions with reasons.** Plain code learns each item's cadence and
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
  map their store, with the people it detects pixelated first.
- **Open to other apps.** A developer portal (/developers) with an open
  Lists API, per-account tokens and a standard MCP connector, so an
  MCP-capable assistant can read the list and add to it.

## How Meta models are used

- **Muse as a client of Arya (live).** Muse connects to Arya over MCP as an agent, with the code pasted into Muse's secure credentials vault, and uses six tools to read the list, add and check off items, and file receipts it read in chat. Tested on my own Muse on 2026-11-02.

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
  seat. It judges again from item names alone (no prices, dates, stores or account details).
- **SAM 3.1**: finds shelves and signs in the guided store scan, boxes
  candidates for Find it for me (Spark then checks each crop), and finds
  people so they are pixelated before any frame is kept.
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
patterns and lists; a React + TypeScript PWA (a website that installs to the Home Screen like an app); in-process demo sandboxes;
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
  people and pixelates them before a store frame is saved, and the scan fails
  closed.

## Accomplishments and evidence

- 114 of my own Costco receipts (three years, 1,226 lines) came
  in as the Costco app's export; code parsed them and 114 of 114 add up to
  the printed total. Muse Spark expanded the abbreviated names.
- Staple judge: precision 0.79 against a purchase-cadence proxy on those
  114 receipts. Muse Spark Open and hosted Spark agreed on all 32 test
  names for category and section.
- Receipt photo test (9 public receipts, 98 lines): Wonder 97/98, 0 price
  errors; Spark 92/98, 4 price errors. Public test receipts never entered
  my data.
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

**Markets.** Built and tested with US receipts, dollars and stores first; other markets not tested.

## Feedback from using partner technologies (about 320 words)

**Meta Model API (Muse Spark and Muse Wonder).** Spark was the workhorse: receipt reads, list photos, Ask Arya, list suggestions and the staple judge all run on it. Spark cost about $0.013 per receipt read in our eval; we also send prompt_cache_key so the shared prompt prefix is cached. In our 9-receipt eval, Wonder was the more accurate reader (97 of 98 lines after hand checking; on the automatic scorer, Spark 92 and Wonder 86, because the scorer was tuned on Spark's output and counted Wonder's spelled-out brand names, such as "PF" as "Pepperidge Farm", as wrong, though every price on those lines was exact) but about four times slower: a 34 s mean and a 60.5 s p95, against Spark's 8.6 s and 11.9 s. That gap shaped the product. Spark reads first, arithmetic checks run, and Wonder re-reads only the receipts the checks flag, with a 60 s cap. What was rough: Spark's mistakes were often silent (4 of its 6 wrong lines carried no low-confidence flag), so we had to build our own checks. A read timeout is ambiguous about billing, so we never retry one. Content-policy errors arrive as raw HTTP 400 text that we had to translate for people. Asks: a per-line confidence that tracks real accuracy, a latency or priority option for Wonder, clear billing rules for timed-out calls, and typed error codes.

**Baseten (open weights).** We ran Muse Spark Open on Baseten for batch jobs that touch only platform data: labeling the shared item dictionary with category and store section, and a second opinion for the staple judge. The OpenAI-style endpoint dropped in beside our hosted client with little new code, and on a 32-name test it agreed with hosted Spark on every category and store section. Rough: our partner key answered only one model name, and when our model setting was blank, Baseten replied with a bare HTTP 400 instead of naming the problem. Asks: a clear error for an unknown or empty model, and a usage view that maps to the credit grant.

**Kroger Products API.** It gives live aisle locations for Kroger-family stores, which became Arya's aisle hints. It was easy to start with. It is a suggestion layer only; crowd mapping stays the core. Rough edges: responses carry no cache headers, so every lookup is live, and we set our own daily cap. Ask: a published per-app call limit and a clear attribution rule.

**Supabase.** Email-code and Google sign-in through the REST auth API, with no client library, plus a Postgres mirror of our JSON documents. Both are live. **Resend.** Waitlist and account-deletion emails, best effort. We hit no notable problems with either.

## How creatively did we use Meta's AI tooling? (about 240 words)

1. **Muse connected itself to Arya.** This surprised us most. Arya has an MCP server with six tools: get_snapshot, get_list, add_items, check_item, file_receipt and get_receipts. On Nov 2 we set it up on a real Muse account with no terminal and no settings file. We tapped "Make my code" in Arya and asked the Muse agent to connect to Arya at its address. Muse asked for the code, opened its own secure credentials box for it (so the code never went into the chat), and the connection worked. Arya's connector carries its own instruction doc, so the person writes no prompt. After that, "add oat milk to my list" in Muse changes the real list in Arya. We think it was this easy because the whole stack is Meta's. Muse is the assistant, Muse Spark and Wonder (through the Meta Model API) read the receipts and answer Ask, and Muse Spark Open has run batch jobs for us on item names, so Arya fits in as one more piece of the same ecosystem.

2. **Two Meta models as a checked team.** On real receipts, Wonder was more accurate, but Spark was about nine times cheaper and four times faster, and most of Spark's errors were silent. So Spark reads first, and plain code checks the arithmetic, the item count and each price against the item's own history. Only flagged receipts go to Wonder, and every receipt records who read it and why.

3. **SAM 3.1 for privacy.** When a shopper photographs a shelf, SAM finds every person in the frame and Arya pixelates them before anything is saved. The same model proposes product boxes, and Arya checks the top three, not just the best one.

Also built, but switched off: an Alexa skill that sends misheard adds to Spark in the background, where Spark matches them against the person's real list names.

## Try it

- Live: https://arya.teamnightshift.org. Tap "Try it now" for a fictional
  household with no account. Each visitor's changes stay in a sandbox for
  that visit only. Sign-up is invite only during judging.
- Judge path (about 8 minutes): `docs/quest/JUDGE-PLAYBOOK.md`.
- Repo: https://github.com/vibhortayal/arya
- Video: (linked once recorded)

## Track and team

Indie track. Team Nightshift: Vibhor Tayal (representative and only
member), building with Claude Code as the coding agent.
