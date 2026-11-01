# Arya

**She remembers the list.**

Arya is a grocery list that learns. It reads your receipts, checks every
line against the printed total, and learns what your household buys, how
often, and at which store. The list then mostly writes itself: what is
running low, what to use soon, and where you usually buy it.

Start shopping - Go on a Quest to make the chore feel like a game. It turns
your list into a hunt through a model of your store and ends on a photo of
your receipt.

Built for the Meta Global AI Developer Hackathon 2026 (Team Nightshift,
Indie track). Submission deadline: Nov 4, 2026, 9:00 PM ET.

**For developers:** open Lists API and docs at https://arya.teamnightshift.org/developers.

**Live demo:** https://arya.teamnightshift.org. Tap "Try it now". It opens a
fictional household with no account. Your changes live in a sandbox for your
visit only; nothing reaches disk or another visitor.

<p align="center">
  <img src="docs/images/today.png" alt="Today: what is running low, store alerts, what to use soon" width="230">
  <img src="docs/images/lists.png" alt="Lists: one card per store list, with suggestions" width="230">
</p>
<p align="center"><em>Today and Lists in the demo household.</em></p>

## Try it in one minute

1. Open the demo. **Today** shows what is running low and why.
2. Open **Lists**. Add an item by typing, with the mic, or with a photo of a handwritten note.
3. Open **Ask** and type "We finished the Greek yogurt", then "What am I running low on?".
4. Open a list and tap **Start shopping** to start a quest at that list's store.
5. For a longer path through the app, see [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md).

The bar at the bottom starts as Today, Lists, Quest, Ask and More. More holds Help, Settings and every place not on the bar. Each shopper can change the bar: touch and hold it, or tap More, then Customize bar.

## What is in it

- **Receipts.** A photo or PDF goes in. Muse Wonder reads photos (Muse Spark
  is the fallback); code checks every line against the printed total before
  anything posts. Returns net out against purchases. Items bought for
  someone else are tracked but never suggested.
- **Lists.** Type, talk, photograph a note, or use your own assistant through
  the MCP connector (`assistant/docs/AGENT-CONNECTOR.md`). Items you add stay
  on the list. Staples that are due show as suggestions, each with a reason.
- **Patterns and the staple judge.** Deterministic code learns how often you
  buy each item and what you pay at each store. A Muse Spark judge decides
  which items count as staples. Muse Spark Open (open weights, on Baseten)
  judges again from item names alone; disagreements are kept for review.
  The Curator proposes product merges and splits, and you apply them.
- **Prices from your own receipts.** Cheaper store, price trend, food-waste
  cost. Nothing is fetched from store sites, flyers, APIs or the web.
- **Ask Arya.** A chat over a snapshot of your household's data. It can
  also act on statements such as "we finished the yogurt".
- **Groups.** Share lists with the people you live with. Receipts stay with
  whoever filed them.
- **Quest.** Pick a store and Arya sorts your list for it. Grab items to earn
  points; there is no clock and no way to lose. **Find it for me** points the
  camera at a shelf: SAM 3.1 boxes candidates and Muse Spark checks each one.
  **Map this store** is a guided camera scan: you pan along the shelves, SAM
  3.1 blurs every person before anything is kept, and Muse Spark reads
  sections, aisle signs and prices. A store counts as mapped only where it
  has a usable, fresh photo. No store ships pre-mapped; an unmapped store
  plays as a labelled typical layout. Points bank when the receipt settles.
- **Demo Town** (off by default, `ARYA_DEMO_TOWN=1`): the demo household shops
  at invented stores in a simulated neighborhood, labelled as simulated.

## Names for the help parts

Three parts help a new person. Use these words in the app, the docs, and code review.

| Name | What it is | Where in the code |
|---|---|---|
| **Tour** | Bubbles over a dimmed screen that point at things. Real accounts get one stop per place on their bar, then More, then "Make the bar yours". The demo gets a stop for each screen and each main card on it, in the shopper's bar order, with "Skip Today" to jump to the next screen. | `web/src/ui/Tour.tsx`, `onboarding/firstRunTour.ts`, `onboarding/demoTour.ts` |
| **Arya guide** | The swipeable cards (sixteen), each with a short line and numbered steps. Opens from Help tab, Arya's powers, or the end of the Tour. | `web/src/ui/Guide.tsx`, `guide/cards.ts` |
| **Help tab** | Everything else: the ask box, first steps, a how-to topic for each feature, plus links to the Arya guide, Arya's powers, the Tour and Send feedback. | `web/src/screens/Help.tsx`, `guide/helpTopics.ts` |

Ask Arya answers how-to questions from `assistant/prompts/arya_features.md`.
When a change moves or adds UI, update the Tour, the Arya guide, the Help
tab and that file in the same PR.

## How it fits together

<p align="center">
  <a href="assistant/docs/ARCHITECTURE.md"><img src="assistant/docs/architecture.svg" alt="Arya architecture: PWA and Muse agent, Caddy, FastAPI routes, deterministic engines, Meta models, storage" width="760"></a>
</p>

A phone-first PWA (React and TypeScript, built with Vite) talks to one
FastAPI process behind Caddy. Code does the money, timing and list logic, so
those cost nothing per call. Meta models read photos, judge staples and
answer questions, and every call goes through one module
(`assistant/api/meta_client.py`). State is JSON documents on a Docker volume,
or Supabase Postgres. Details, feature flags and the VM runbook:
[`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md).

Spark runs on Meta's Contributor tier by default (owner decision
2026-11-01), so content sent to Spark may be used to train future Meta models;
`ARYA_SPARK_TIER=standard` switches it back. Wonder stays on Standard. The
open-weights client refuses personal data. Cost rules are in
[`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

## Run it yourself

You need Python 3.12 and Node 22. Without a `MODEL_API_KEY`, the app and the
demo household run, but anything that calls a Meta model fails with a
plain error.

```
python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt
cd assistant/web && npm ci && npm run build && cd ..
../.venv/bin/python -m harness.make_demo_household data   # builds the demo household
MODEL_API_KEY=<your key> ../.venv/bin/python -m uvicorn api.main:app --port 8000
```

Open http://localhost:8000 and tap "Try it now". For front-end work,
`npm run dev` in `assistant/web` starts Vite. The full Docker setup (API and
Caddy) is in `assistant/deploy/`; settings are listed in
[`assistant/deploy/.env.example`](assistant/deploy/.env.example).

Tests, from the repo root:

```
(cd assistant && ../.venv/bin/python -m unittest discover -s tests)   # 1,235 tests
(cd assistant/web && npm test)                                        # vitest
```

## Measured results

- **Receipt photos, production reader (Muse Wonder 1.0, Spark fallback).**
  On the Gate 0 public set (9 receipts, 98 lines): 97 of 98 lines have the
  right product and price after hand adjudication, with zero price errors
  and arithmetic matching on 7 of 7 receipts. The automatic scorer gives
  87 of 98. Muse Spark on the same set: 92 of 98. Record:
  `assistant/loops/2026-10-27-wonder-decode.md`.
- **Gate 0, before Wonder (Muse Spark).** Public set 90 of 98 lines
  (91.84%), owner subset 32 of 32, combined 122 of 130 (93.85%). One silent
  price rotation got through. It is recorded, and the review queue is the
  mitigation.
- **Open weights.** Muse Spark Open and hosted Spark labeled the same 32
  grocery names: category and section agreement were both 100%. On the demo
  account's judged staples the second seat agreed on 3 of 4. The one
  disagreement (Greek Yogurt: staple by name, occasional by purchase facts)
  is why names advise and purchase facts decide.
  `assistant/loops/2026-10-28-open-weights.md`.
- **Staple judge.** Precision 0.79 against a purchase-cadence proxy on the
  owner's 114 receipts.
- **Owner corpus.** 114 receipts, 1,226 lines, 114 of 114 passing the
  arithmetic check.

The Gate 0 and judge evaluation records are in the companion research repo,
`vibhortayal/meta-hackathon-research`.

## Where things are

| Path | What |
|---|---|
| `assistant/api/` | FastAPI app, one router per area in `routes/`, engines |
| `assistant/web/` | React app (screens, Quest game, service worker) |
| `assistant/pwa/` | Static files: images, three.js, manifest, icons |
| `assistant/deploy/` | Docker Compose, Caddyfile, backup and restore scripts |
| `assistant/docs/` | Spec, architecture, model policy, runbooks |
| `docs/quest/` | Quest design and the hackathon doc pack |
| `assistant/loops/` | One log per work session |
| `STATUS.md` | What is true on `main` today |

Agents: read [`AGENTS.md`](AGENTS.md) first. The spec
(`assistant/docs/SPEC.md`) wins when it disagrees with the code.

## How this was built

Everything here was built in the hackathon window, which opened on Oct 27,
2026. The first commit is Oct 27, 15:13 ET. The engine (decode, dictionary,
ledger, patterns, the first PWA) was written by Muse Wonder in a separate
spike session and committed here in stages over about 30 minutes, which is
why the early commits arrive so fast. The session logs in `assistant/loops/`
record the rest. The owner's 114 receipts (back to 2023) are the owner's
purchase history, imported as data. They are not in this repository.

## Characters

Quest's collect animations use characters painted with Muse Image.

<p align="center">
  <img src="assistant/pwa/assets/characters/raspberry.webp" alt="Raspberry" width="96">
  <img src="assistant/pwa/assets/characters/mandarin.webp" alt="Mandarin" width="96">
  <img src="assistant/pwa/assets/characters/almond.webp" alt="Almond" width="96">
  <img src="assistant/pwa/assets/characters/milk.webp" alt="Milk" width="96">
  <img src="assistant/pwa/assets/characters/egg.webp" alt="Egg" width="96">
  <img src="assistant/pwa/assets/characters/bread.webp" alt="Bread" width="96">
</p>

## License

All rights reserved; see `LICENSE`. Third-party code and asset notes are in
`NOTICE.md`.
