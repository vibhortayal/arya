# For judges

Arya is a grocery app that learns how you shop from your receipts, keeps the household list for you, guides you through the store, and lets shoppers warn each other when a shelf is empty. Every intelligent step is a Meta model; the money, timing and list logic is plain code.

Indie track, solo, built in the hackathon window (Oct 27 to Nov 4, 2026) for the problem statement **Build for Your World**: a tool for everyday life that depends on Meta's models for reading receipts, labels, voice and shelves.

## Start here

- **Try it, no sign-up:** https://arya.teamnightshift.org, then tap "Try it now". It opens a fictional household in a sandbox that exists for your visit only. Best on a phone; on a laptop, make the window about 390 px wide. Camera steps need a phone.
- **Demo video (3 min):** linked here when it is ready. The live demo and the guided path work without it.
- **Guided path through the app (8 minutes):** [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md), with a [sample receipt photo](docs/images/sample-receipt.jpg) and a [sample shelf photo](docs/images/sample-shelf.jpg) to try the camera steps.
- **Everything else:** the [README](README.md) (what it is, why I built it this way, measured results, known limits) and the [docs site](https://vibhortayal.github.io/arya/).

## How do I try it? (Demo, 25%)

- The same loop as the video plays live: Today, Ask ("We finished the Greek yogurt"), Start shopping, and Lists under More. [`README.md`](README.md#try-it-in-one-minute)
- Steps that need a phone camera or mic: voice add, photo of a note, Find it for me, Map my store, receipt snap. Everything else works on a laptop.
- Nearly every feature works live in the demo (the staple-judge verdicts were computed beforehand); only the data (the household, stores and other shoppers) is simulated, and nothing you add is kept past your visit. What the demo household contains: [`assistant/docs/DEMO.md`](assistant/docs/DEMO.md).
- **Run it yourself** with your own key: [Run it yourself](docs/RUN-IT-YOURSELF.md) (it includes a prompt that lets [an AI agent set it up for you](docs/RUN-IT-YOURSELF.md#let-your-ai-agent-set-it-up)), or the [setup in the README](README.md#run-it-yourself).
- **Want an account?** Sign-up is invite only while I harden the cost guard rails. Tap "Join the waitlist" on the [landing page](https://arya.teamnightshift.org) and reach out ([support@teamnightshift.org](mailto:support@teamnightshift.org) or [LinkedIn](https://www.linkedin.com/in/vibhortayal)); judges can be approved.

## Does it matter to real people? (Impact, 30%)

**What is the real-world potential?** Everyone who shops for a household does the same weekly work: remembering the list, not rebuying what is in the cupboard, and wondering where the money went. A receipt holds all of that and nobody reads it. Arya reads it, checks every line against the printed total, and turns it into a list with reasons ([how it works](README.md#what-is-arya)). On my own 114 receipts (1,226 lines) every one passed the arithmetic check, and about 4 in 5 of the staple judge's suggestions matched my own purchase rhythm (precision 0.79 against a purchase-cadence proxy; [measured results](README.md#measured-results)).

**Who benefits, and how much does it matter?** People who keep a household or a group fed, and share a list ([who it is for](docs/PRINCIPLES.md)). It matters as a weekly chore and a household budget, not as a rare event. I have not measured time or money saved, and I tested on one household, so I do not claim a number ([Known limits](README.md#what-are-the-known-limits)).

**Could it become something people use?** It already runs: live, installable, free to use, with a no-account demo, shared lists for groups, a Lists API and an MCP connector so an agent can edit your lists ([agent connector](assistant/docs/AGENT-CONNECTOR.md)). Store maps already merge across shoppers, so each trip helps the next; shared prices are planned and not switched on. It runs as one server today, and the plan to scale it is in the [roadmap](docs/ROADMAP.md). Rome wasn't built in a day: I built the foundation, and the more people use Arya the better it gets for them.

**Why this is built for our world:** it is a shopper's problem I had personally ([why Arya exists](docs/PRINCIPLES.md)), and it is free to use. What existed before Oct 27, and a dated table of what I made in the window: [`docs/WHAT-WE-BUILT.md`](docs/WHAT-WE-BUILT.md).

## Which Meta models does it use, and for what? (Meta AI tooling, 25%)

Six Meta products plus the Meta Model API, each with one job. Every call goes through one module, [`assistant/api/meta_client.py`](assistant/api/meta_client.py). The full table with where each lives in code: [`docs/quest/META-PRODUCTS.md`](docs/quest/META-PRODUCTS.md).

- Spark reads receipt photos first; Wonder re-reads only a receipt the arithmetic checks flag. Code: [`decode/service.py`](assistant/api/decode/service.py), [`checks.py`](assistant/api/decode/checks.py).
- Muse Spark Open (open weights, hosted on Baseten) is a second seat on the staple judge; it sees item names only. [`open_client.py`](assistant/api/open_client.py)
- SAM 3.1 boxes shelf items and pixelates the people it detects before any frame is kept; if that step fails the frame is discarded. Detection is not perfect and has not been scored. [`shelfscan.py`](assistant/api/shelfscan.py)
- Muse can use Arya: any MCP-capable assistant connects to Arya's MCP address, and Muse is the reference client. I tested it end to end on my own Muse on 2026-11-02; it read my list, added items and filed receipts through six tools. Setup and details: [README, "Muse can use Arya"](README.md#why-i-built-it-this-way), [agent connector](assistant/docs/AGENT-CONNECTOR.md), code in [`mcp.py`](assistant/api/mcp.py).
- Available but not used: Muse Glimmer (open weights, self-hosted) and the Spark Contributor tier (cheaper, different data terms). Reasons: [`docs/MODELS.md`](docs/MODELS.md).
- Built with Muse Code: it wrote the first version of the engine. The Meta Muse agent on my VM (Muse Spark, which used Muse Wonder) coded in parallel with Claude, and the 253 commits named "Spark" are its work. Details: [README, "How this was built"](README.md#how-this-was-built).

### Which model does which job?

| Meta product | Id | Job | Measured |
|---|---|---|---|
| Muse Spark 1.3 (Standard) | `muse-spark-1.3` | Reads receipt photos first; staple judge, Curator, Ask Arya, list and date photos, shelf labels, crop checks | 92 of 98 lines on the Wonder comparison set; staple precision 0.79. [Details](README.md#measured-results) |
| Muse Wonder 1.0 | `muse-wonder-1.0` | Re-reads a receipt the checks flag, or when Spark fails | 97 of 98 lines after hand adjudication, read alone. [Details](README.md#measured-results) |
| SAM 3.1 | via Meta Model API | Finds shelves and signs, boxes items for Find it for me, pixelates the people it detects | Used in the guided store scan |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | Dictation for the list mic and Ask Arya | n/a |
| Muse Image 1.0 | `muse-image-1.0` | The 23 grab-celebration characters (generated once) and share looks (live, per tap) | n/a |
| Muse Spark Open | `meta-models/muse-spark-open-1026` (hosted on Baseten) | Second seat of the staple judge; dictionary labels | 32 of 32 labels agree with hosted Spark; 3 of 4 staple verdicts |

Spark and Wonder run in Meta's Standard mode. The live reader is `auto` (the code default, `ARYA_PHOTO_READER=auto`): Spark first, Wonder re-reads a flagged receipt; the pair has not yet been measured on photos. Every server call goes through one client with a daily spend ceiling. Reader history is in [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

Eval numbers come from one small set (9 public receipts, 98 lines) where scores vary run to run, so quote the gap between the models, not either number alone. The runs, the scorer and the hand adjudication are in [`docs/evals/`](docs/evals/).

## How is it built, and how well? (Technical depth, 20%)

- Model proposes, code checks: arithmetic reconciliation, returns, cadence and prices are deterministic, with a cost ledger and daily spend caps. The full list of claims and where to verify each is in the [judge playbook](docs/quest/JUDGE-PLAYBOOK.md#how-is-it-built-technical-depth-20).
- Why these choices (the idea, a PWA, the stack, hosting, the coding model and each Meta model): [README, "Why I built it this way"](README.md#why-i-built-it-this-way).
- Depth: about 1,900 Python and 550 web tests (as of Nov 3), and a dated [decision log](docs/DECISIONS.md).
- Read more: design decisions, what I could finish in the window and what is pending, and where it stops scaling, in [`docs/TECHNICAL-DEPTH.md`](docs/TECHNICAL-DEPTH.md).

## What does it not do yet?

- **Data.** Tested on one household's 114 receipts and a 9-receipt public set, so the measured numbers come from small samples.
- **Markets.** Built and tested with US receipts, dollars and stores first; other markets not tested.
- **Devices.** Real-device testing was on one iPhone. The Quest-start and live-walk location checks are not tested indoors on a real phone, and a store with no stored address point cannot be checked.
- **Store maps.** No store ships pre-mapped; a store's map comes only from shoppers' guided scans.
- **Scale.** Arya runs as one server process on one VM, so a few dozen people at once is about the limit ([details](README.md#what-are-the-known-limits)); scaling it out is a plan for after judging, not built.
- **Demo allowance.** Each demo visit can spend about $0.40 on live Meta calls and the demo has a daily cap. When either runs out the app says so; lists and everything that needs no live read keep working, and **Use a sample receipt** still works.
- **Accounts.** Sign-up is invite only, for a few beta testers and hackathon judges ([how to get in](#how-do-i-try-it-demo-25)). The demo needs no account.
- **Licence.** Arya's own code is all rights reserved; the repository has no license file.
