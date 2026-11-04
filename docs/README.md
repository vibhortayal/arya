# Arya documentation index

Every document in this repository, grouped by who reads it. Each fact has one home; other pages link to it. The docs site (https://vibhortayal.github.io/arya/) is built from the same files, so nothing here is copied.

## Judging? Read these, in this order

| Read | What it holds | Time |
|---|---|---|
| [`JUDGES.md`](../JUDGES.md) | The one page for judges: the rubric blocks, the Meta model map, proof links, what it does not do yet | 5 min |
| [`docs/quest/JUDGE-PLAYBOOK.md`](quest/JUDGE-PLAYBOOK.md) | The eight-minute walk through the live demo, with the sample receipt and shelf photos | 8 min |
| [`README.md`](../README.md) | What Arya is, why it is built this way, measured results, known limits, run it yourself | 10 min |
| [`docs/WHAT-WE-BUILT.md`](WHAT-WE-BUILT.md) | What existed before the window, what was made in it and when (from git), every feature with why it matters | 5 min |
| [`docs/TECHNICAL-DEPTH.md`](TECHNICAL-DEPTH.md) | What is built, what is known to be weak, and the plan to grow past one server | 3 min |
| [`docs/evals/`](evals/README.md) | The file behind every measured number | as needed |

Live demo: https://arya.teamnightshift.org (tap "Try it now", no sign-up).

## Where each fact lives

When two pages seem to say the same thing, the page in this table is the one to trust and edit; the others should link to it.

| Fact | Home |
|---|---|
| Which Meta model does which job, with ids | [`JUDGES.md`, "Which model does which job?"](../JUDGES.md#which-model-does-which-job) |
| Where each Meta product sits in the code | [`docs/quest/META-PRODUCTS.md`](quest/META-PRODUCTS.md) |
| Model prices, the reader rule, spend caps | [`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md) |
| Measured numbers (Gate 0, Wonder eval, staple judge) | [`docs/evals/README.md`](evals/README.md) |
| Known limits | [`README.md`, "What are the known limits?"](../README.md#what-are-the-known-limits) |
| What was built and when | [`docs/WHAT-WE-BUILT.md`](WHAT-WE-BUILT.md) |
| What is true on `main` today | [`STATUS.md`](../STATUS.md) |
| Decisions, dated | [`docs/DECISIONS.md`](DECISIONS.md) |
| Feature flags and their defaults | [`assistant/docs/ARCHITECTURE.md`, section 0.11](../assistant/docs/ARCHITECTURE.md#011-feature-flags-and-settings) |
| Product rules (what and why) | [`assistant/docs/SPEC.md`](../assistant/docs/SPEC.md) |
| How the built system fits together | [`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md) |
| The demo video narration | [`docs/demo-video/SCRIPT.md`](demo-video/SCRIPT.md) |
| Ideas not built | [`docs/ROADMAP.md`](ROADMAP.md) |
| Rules for every agent and the team roles | [`AGENTS.md`](../AGENTS.md) |

## Using Arya

| Read | What it holds |
|---|---|
| [`assistant/docs/USER-JOURNEYS.md`](../assistant/docs/USER-JOURNEYS.md) | Seven journeys, screen by screen, with sample data and screenshots |
| [`docs/TRY-THE-FEATURES.md`](TRY-THE-FEATURES.md) | A feature-by-feature tour of your own copy |
| [`docs/quest/README.md`](quest/README.md) | Quest, the optional game, and its doc pack |
| [`docs/quest/GAME-DESIGN.md`](quest/GAME-DESIGN.md) | Rules, rewards, Spotter, community |
| [`docs/quest/MAP-MY-STORE.md`](quest/MAP-MY-STORE.md) | How shoppers map a store and how maps merge |
| [`assistant/docs/AGENT-CONNECTOR.md`](../assistant/docs/AGENT-CONNECTOR.md) | Use Arya from Muse or any MCP agent |
| [`assistant/docs/MULTILINGUAL-ASK.md`](../assistant/docs/MULTILINGUAL-ASK.md) | Ask answers in the language you write in (spec and build status) |
| [`docs/GLOSSARY.md`](GLOSSARY.md) | The words Arya uses |
| [`docs/PRINCIPLES.md`](PRINCIPLES.md) | Why Arya exists and who it is for |

## How it is built

| Read | What it holds |
|---|---|
| [`assistant/docs/SPEC.md`](../assistant/docs/SPEC.md) | The product specification; wins over the code |
| [`assistant/docs/IMPLEMENTATION.md`](../assistant/docs/IMPLEMENTATION.md) | Method, contracts, stages, golden sets |
| [`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md) | The one-page map (section 0) and the design record |
| [`docs/SCALABILITY-DESIGN.md`](SCALABILITY-DESIGN.md) | The phased plan to grow past one server (a plan, not built) |
| [`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md) | Cost rules, prices, the reader rule, the demo budget |
| [`docs/MODELS.md`](MODELS.md) | Every Meta model offered, used or not, and why |
| [`docs/quest/META-PRODUCTS.md`](quest/META-PRODUCTS.md) | Each Meta product and where it sits in the code |
| [`docs/quest/ARCHITECTURE.md`](quest/ARCHITECTURE.md) | Quest's two data planes and pipelines |
| [`DESIGN.md`](../DESIGN.md) | The visual language as shipped: tokens, components, motion |
| [`assistant/web/PORTING.md`](../assistant/web/PORTING.md) | Rules for working on the React app |
| [`assistant/web/src/game/README.md`](../assistant/web/src/game/README.md) | The Quest game module |
| [`docs/ENGINEERING-PROCESS.md`](ENGINEERING-PROCESS.md) | How one person and a team of AI agents built it |
| [`docs/DECISIONS.md`](DECISIONS.md) | Every decision, dated, newest first |
| [`assistant/loops/`](../assistant/loops/README.md) | One log per work session, kept as written |

## Evidence

| Read | What it holds |
|---|---|
| [`docs/evals/README.md`](evals/README.md) | Index of the measured results |
| [`docs/evals/GATE-0-REPORT.md`](evals/GATE-0-REPORT.md) | Muse Spark on 9 public receipt photos |
| [`docs/evals/WONDER-EVAL.md`](evals/WONDER-EVAL.md) | Spark against Wonder, line by line |
| [`docs/evals/JUDGE-EVAL.md`](evals/JUDGE-EVAL.md) | Staple judge precision against a cadence proxy |
| [`docs/evals/gate0-public-set/`](evals/gate0-public-set/manifest.json) | Hand labels, raw results, scores and scripts |
| [`assistant/docs/SCALE-SIM.md`](../assistant/docs/SCALE-SIM.md) | The scale simulator and what it measured |

## Developers

| Read | What it holds |
|---|---|
| [`docs/RUN-IT-YOURSELF.md`](RUN-IT-YOURSELF.md) | Run Arya with Docker and your own Meta key |
| [`docs/API.md`](API.md) | Lists API v1 |
| https://arya.teamnightshift.org/developers | The developer portal and interactive reference |
| [`NOTICE.md`](../NOTICE.md) | Third-party licences and asset provenance |

## Operating it (owner and Ops)

| Read | What it holds |
|---|---|
| [`assistant/docs/OPS.md`](../assistant/docs/OPS.md) | What watches the app, the Ops screen, what to do when it breaks |
| [`assistant/docs/DEMO.md`](../assistant/docs/DEMO.md) | The demo runbook: beats, judge path, fallbacks, say this not that |
| [`assistant/docs/DEMO-TOWN.md`](../assistant/docs/DEMO-TOWN.md) | The simulated neighbourhood: switch, rules, how it is built |
| [`assistant/docs/SIGNIN.md`](../assistant/docs/SIGNIN.md) | Sign-in, the waitlist and the email templates |
| [`assistant/docs/PUSH-REMINDERS.md`](../assistant/docs/PUSH-REMINDERS.md) | Push reminders: switch and cron |
| [`AGENTS.md`](../AGENTS.md) | The agent contract: rules, roles, handoffs, the docs workflow |

## Submission (internal)

| Read | What it holds |
|---|---|
| [`assistant/docs/SUBMISSION-DRAFT.md`](../assistant/docs/SUBMISSION-DRAFT.md) | Paste-ready blocks for the portal form |
| [`docs/quest/SUBMISSION.md`](quest/SUBMISSION.md) | The package checklist and the IP note |
| [`docs/quest/PITCH-SCRIPT.md`](quest/PITCH-SCRIPT.md) | The spoken two-minute pitch |
| [`docs/demo-video/SCRIPT.md`](demo-video/SCRIPT.md) | The demo video narration (working copy) |
| [`docs/MARKET.md`](MARKET.md) | Desk research on the market; its unverified claims are marked |
| [`docs/quest/BUSINESS.md`](quest/BUSINESS.md) | Who it is for, the four pillars, the Oct 27 competitor table |

## Historical (kept as written, superseded in places)

These record how Arya got its shape. Most carry a note saying what replaced it. Read the pages above for what is true now.

| Read | What it holds |
|---|---|
| [`PRODUCT.md`](../PRODUCT.md) | The early product description of 2026-10-27 |
| [`docs/quest/PITCH.md`](quest/PITCH.md) | The early game-first pitch |
| [`docs/quest/BUILD-PLAN.md`](quest/BUILD-PLAN.md) | The build plan as of Oct 29 |
| [`docs/quest/UX.md`](quest/UX.md) | Quest UX rules of Oct 27; the wireframes are the design of record |
| [`docs/quest/DISCUSSION.md`](quest/DISCUSSION.md) | The early design conversation, in order |
| [`docs/quest/wireframes.html`](quest/wireframes.html) and the other `docs/quest/*.html` files | Clickable wireframes and prototypes |
