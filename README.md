<h1 align="center">Arya</h1>
<p align="center"><strong>She remembers the list.</strong></p>
<p align="center">
  A grocery list that learns from your receipts, then mostly writes itself.<br>
  Built for the Meta Global AI Developer Hackathon 2026 (Team Nightshift, Indie track).
</p>

<p align="center">
  <a href="https://arya.teamnightshift.org"><strong>Open the live demo</strong></a>
  (tap "Try it now", no sign-up) &nbsp;|&nbsp;
  <a href="JUDGES.md"><strong>Judging this? Start here</strong></a>
  &nbsp;|&nbsp;
  <a href="#documentation-map"><strong>All the docs</strong></a>
</p>

<p align="center">
  <img src="docs/images/today.png" alt="Today: what is running low, store alerts, what to use soon" width="230">
  <img src="docs/images/lists.png" alt="Lists: one card per store list, with suggestions" width="230">
</p>
<p align="center"><em>Today and Lists in the demo household (a simulated neighborhood, labelled as such).</em></p>

## What it is

Arya reads your receipts, checks every line against the printed total, and
learns what your household buys, how often, and at which store. The list then
mostly writes itself: what is running low, what to use soon, and where you
usually buy it, each with a reason.

It is for people who shop for a household, and for groups who share a list. It
is a phone-first app (a PWA), and it also has an optional game, **Quest**, that
turns the shopping trip into a hunt through a model of your store and ends on a
photo of your receipt.

**Live demo:** https://arya.teamnightshift.org. The demo opens a fictional
household with no account. Your changes live in a sandbox for your visit only;
nothing reaches disk or another visitor. It is best on a phone; on a laptop,
make the window about 390 px wide. Open Lists API and docs for developers:
https://arya.teamnightshift.org/developers.

Submission deadline: Nov 4, 2026, 9:00 PM ET.

## Why it is different

- **The model proposes, code checks.** A model reads the receipt photo; plain
  code then checks every line against the printed total before anything posts.
  Money, timing and list logic are deterministic and cost nothing per call.
- **Every Meta model has a job.** Muse Spark, Muse Wonder, SAM 3.1, Muse Voice
  Transcribe, Muse Image and Muse Spark Open (open weights, hosted on Baseten)
  each do one thing, through one module. See the [model map](JUDGES.md#meta-model-map).
- **Prices come from your own receipts.** Nothing is fetched from store sites,
  flyers, APIs or the web.
- **Bring your own assistant.** Add items by typing, voice, a photo of a
  handwritten note, or any AI agent through the MCP connector.
- **Quest has no clock and no way to lose.** Optional, and it never gets in the
  way of the list.

## What judges should read first

1. [`JUDGES.md`](JUDGES.md): the rubric, the Meta model map and proof links on one page.
2. [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md): a guided path through the live app.
3. [`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md) and [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md): how it fits together and why each model.
4. [`docs/evals/`](docs/evals/): the measured results behind the numbers.
5. [`STATUS.md`](STATUS.md): what is true on `main` today.

## Documentation map

| If you want to know... | Read |
|---|---|
| The rubric, model map and proof | [`JUDGES.md`](JUDGES.md) |
| What the product is, in full | [`assistant/docs/SPEC.md`](assistant/docs/SPEC.md) |
| Screen-by-screen journeys | [`assistant/docs/USER-JOURNEYS.md`](assistant/docs/USER-JOURNEYS.md) |
| How it fits together | [`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md) |
| Which model does what, and what it costs | [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md) |
| Stack, hosting, deploy, backups | [Tech stack and deployment](#tech-stack-and-deployment), [`assistant/docs/OPS.md`](assistant/docs/OPS.md) |
| The Quest game | [`docs/quest/README.md`](docs/quest/README.md), [`docs/quest/GAME-DESIGN.md`](docs/quest/GAME-DESIGN.md) |
| Using your own AI assistant | [`assistant/docs/AGENT-CONNECTOR.md`](assistant/docs/AGENT-CONNECTOR.md) |
| The demo household | [`assistant/docs/DEMO.md`](assistant/docs/DEMO.md) |
| Measured results | [`docs/evals/`](docs/evals/) |
| Open API | https://arya.teamnightshift.org/developers, [`docs/API.md`](docs/API.md) |
| How the project is run by agents | [`AGENTS.md`](AGENTS.md) |
| Running it on your own computer | [`docs/RUN-IT-YOURSELF.md`](docs/RUN-IT-YOURSELF.md) |
| What is not built yet | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| What is done and what is not | [`STATUS.md`](STATUS.md) |

## Try it in one minute

1. Open the demo. **Today** shows what is running low and why.
2. Tap **More**, then **Lists**, and open a list. Add an item by typing, with the mic, or with a photo of a handwritten note.
3. Open **Ask** and type "We finished the Greek yogurt", then "What am I running low on?".
4. Open a list and tap **Start shopping** to start a quest at that list's store.
5. For a longer path through the app, see [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md).

The bar at the bottom starts as Today, Spending, Quest, Ask and More. More holds Lists, Receipts, Stores, Help, Settings and every place not on the bar. Each shopper can change the bar: touch and hold it, or tap More, then Customize bar.

## What is in it

- **Receipts.** A photo or PDF goes in. Muse Spark reads photos first and Muse
  Wonder re-reads any the checks flag; code checks every line against the printed total before
  anything posts. Returns net out against purchases. Items bought for
  someone else are tracked but never suggested.
- **Lists.** Type, talk, photograph a note, or use your own assistant through
  the MCP connector (`assistant/docs/AGENT-CONNECTOR.md`). Items you add stay
  on the list. Staples that are due show as suggestions, each with a reason.
- **Patterns and the staple judge.** Deterministic code learns how often you
  buy each item and what you pay at each store. A Muse Spark judge decides
  which items count as staples. Muse Spark Open (open weights, hosted on Baseten)
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

Spark and Wonder run in Meta's Standard mode, which Meta does not use to train
its models (set on the Ops screen; `ARYA_SPARK_TIER` is the environment switch).
The open-weights client refuses personal data. Cost rules are in
[`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

## Tech stack and deployment

| Layer | What it uses |
|---|---|
| App | React 19 and TypeScript, built by Vite into a phone-first PWA with a service worker; three.js for the Quest world |
| API | Python 3.12, FastAPI on uvicorn; one process serves the API and the built app |
| Models | Meta Model API (`api.meta.ai`): Muse Spark, Muse Wonder, SAM 3.1, Muse Voice Transcribe, Muse Image. Muse Spark Open (open weights) is hosted on Baseten and sees names only |
| Storage | JSON documents on a Docker volume, or Supabase Postgres (`ARYA_STORE`); optional Supabase Auth for email code and Google sign-in |
| Email | Resend (waitlist, account codes, reports) |
| Serving | Caddy for TLS and security headers, in front of the API |
| Hosting | One Oracle Cloud VM (Always Free, ARM), Docker Compose with two services (`api`, `caddy`); live at https://arya.teamnightshift.org |
| Deploy | `git pull` on the VM, then a compose rebuild; nightly backups; health check at `/health` |

Details and the VM runbook are in
[`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md).

## Run it yourself

With Docker and your own Meta key (optional, it turns the AI on):

```
cp .env.local.example .env       # put your key on the MODEL_API_KEY line
docker compose up --build
```

Your key stays on your computer: `.env` is git-ignored, so it is never
committed. Do not put a key in a file that is tracked. Open
http://localhost:8080. On the first visit, create your account (a username
and password) to read your own receipts, or close the sheet and tap "Try it now"
for the demo household. Without a key the app and the demo open, but anything that calls a
Meta model says it cannot reach Meta. Settings, resetting, the no-Docker route
and troubleshooting are in [`docs/RUN-IT-YOURSELF.md`](docs/RUN-IT-YOURSELF.md).

Tests, from the repo root:

```
(cd assistant && ../.venv/bin/python -m unittest discover -s tests)   # counts: STATUS.md
(cd assistant/web && npm test)                                        # vitest
```

## Measured results

- **Receipt photos, Muse Wonder 1.0 alone (now the backup reader).**
  On the Gate 0 public set (9 receipts, 98 lines): 97 of 98 lines have the
  right product and price after hand adjudication, with zero price errors
  and arithmetic matching on 7 of 7 receipts. The automatic scorer gives
  87 of 98. Muse Spark on the same set: 92 of 98. Record:
  `assistant/loops/2026-10-27-wonder-decode.md`.
- **Gate 0, before Wonder (Muse Spark).** Public set 90 of 98 lines
  (91.84%), owner subset 32 of 32, combined 122 of 130 (93.85%). One silent
  price rotation got through. It is recorded, and the review queue is the
  mitigation.
- **Open weights.** Muse Spark Open (hosted on Baseten) and hosted Spark labeled the same 32
  grocery names: category and section agreement were both 100%. On the demo
  account's judged staples the second seat agreed on 3 of 4. The one
  disagreement (Greek Yogurt: staple by name, occasional by purchase facts)
  is why names advise and purchase facts decide.
  `assistant/loops/2026-10-28-open-weights.md`.
- **Staple judge.** Precision 0.79 against a purchase-cadence proxy on the
  owner's 114 receipts.
- **Owner corpus.** 114 receipts, 1,226 lines, 114 of 114 passing the
  arithmetic check.

The scored reports and the Gate 0 labels and results are in
[`docs/evals/`](docs/evals/). The companion research repo,
`vibhortayal/meta-hackathon-research`, holds the earlier spikes.

## Known limits

- **Testing data.** Arya was tested on one household's receipts (114 Costco
  receipts) and a small public receipt set. Data was limited, so the results
  in "Measured results" come from small samples.
- **Devices.** Real-device testing was done only on an iPhone 17 Pro. Other
  phone sizes were checked in a browser at 360x640, 390x844, 430x932 and
  390x568, not on those phones.

## After the hackathon

What ships now is a limited-scope MVP. These are ideas the owner is thinking
about for where Arya could go; they are not commitments, and he needs more time
to figure them out. Nothing in this list is built, except one thing that is
built and switched off: **Use your own Meta key** is built and tested, and off
in the live app only because the key vault secret is not set. There was not
enough time to polish the rollout, and the owner is still deciding when to turn
it on. The ideas, grouped in [`docs/ROADMAP.md`](docs/ROADMAP.md):

- **Devices:** Ray-Ban Meta glasses and Meta Ray-Ban Display glasses.
- **Store data and community:** capture more store data, Arya shoppers and
  community prices, Quest leaderboards, item and store profiles.
- **AI and open weights:** bring your own key finished, replay mode, wider use
  of open weights.
- **Trust and privacy:** photo opt-in, privacy policy, deferred security items.
- **Running it yourself:** a laptop-ready Docker setup, off-site backups, staging.

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

## Built with

Open-source code, models and services Arya builds on. Each keeps its own
license; full notices are in [`NOTICE.md`](NOTICE.md).

| Part | What | License |
|---|---|---|
| App | React, React DOM, three.js, `@react-three/fiber`, i18next, react-i18next, motion, Vite, vite-plugin-pwa, Vitest | MIT |
| App | canvas-confetti | ISC |
| App | TypeScript | Apache-2.0 |
| App | Scalar API Reference (the `/developers/reference` page) | MIT |
| API | FastAPI | MIT |
| API | uvicorn, httpx, pypdf | BSD-3-Clause |
| API | NumPy | BSD-3-Clause (with other permissive terms) |
| API | Pillow | MIT-CMU |
| API | OpenCV (headless), cryptography, pypdfium2 | Apache-2.0 (cryptography: Apache-2.0 or BSD-3-Clause; pypdfium2: BSD-3-Clause or Apache-2.0) |
| API | pywebpush | MPL-2.0 |
| API | psycopg | LGPL-3.0 |
| Serving | Caddy, and the Docker base images (Node, Python) | Apache-2.0, and each image's own terms |
| Models | Muse Spark, Muse Wonder, SAM 3.1, Muse Voice Transcribe, Muse Image, through the Meta Model API | Meta's API terms (hosted; no weights are in this repo) |
| Models | Muse Spark Open (open weights, `meta-models/muse-spark-open-1026`), hosted on Baseten | Muse Model License (Oct 15, 2026) with its Usage Policy: [`LICENSE.md`](https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B/blob/main/LICENSE.md). Not copied into this repo |
| Services | Baseten, Supabase (optional), Resend (email) | Their service terms |

**Built with Muse Spark Open.** Arya uses Muse Spark Open (open weights, hosted
on Baseten) as a second seat on the staple judge and for dictionary labels, and
its outputs appear in the app. It sees item names only, never personal data.

The art in `assistant/pwa/assets/` was generated with Muse Image. The App Store
and Google Play badges in `assistant/pwa/assets/badges/` are those companies'
trademarks, used only to point at an install.

## License

Arya's own code and documents are all rights reserved; see `LICENSE`. The
repository is public so judges can read, run and test it; no license to reuse
it is granted yet, and the choice is still open. Third-party code and asset
notes are in `NOTICE.md`.
