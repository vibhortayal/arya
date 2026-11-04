# For judges

Arya is a grocery app that learns how you shop from your receipts and helps shoppers help each other. It puts the whole grocery chore in one place: shared lists, a guided route through the store, a clear view of your spend and usage, and out-of-stock warnings from other shoppers. Every step that needs AI uses a Meta model. The money, timing and list logic is plain code.

This is an Indie track entry. I built it alone in the hackathon window (Oct 27 to Nov 4, 2026). The problem statement is **Build for Your World**: a tool for everyday life that uses Meta's models to read receipts, labels, voice and shelves.

## Start here

- **Demo video (3 min):** [youtu.be/PeWF66ss3oI](https://youtu.be/PeWF66ss3oI). The live demo and the guided path work without it.
- **Try it, no sign-up:** https://arya.teamnightshift.org, then tap "Try it now". It opens a made-up household in a sandbox. The sandbox exists only for your visit. Use a phone if you can. On a laptop, make the window about 390 px wide. Camera steps need a phone. The guided path through the app takes 8 minutes. It is [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md). It comes with a [sample receipt photo](docs/images/sample-receipt.jpg), a [sample shelf photo](docs/images/sample-shelf.jpg), and a walkthrough video of the same path, with voice and captions (3 min 48 s): [youtu.be/cbJflgCXV5U](https://youtu.be/cbJflgCXV5U).
- **Everything else:** the [README](README.md) (what it is, why I built it this way, measured results, and known limits) and the [docs site](https://vibhortayal.github.io/arya/).

## How do I try it? (Demo)

- You can play the same loop as the video: Today, Ask ("We finished the Greek yogurt"), Start shopping, and Lists under More. [`README.md`](README.md#try-it-in-one-minute)
- These steps need a phone camera or mic: voice add, photo of a note, Find it for me, Map my store, and receipt snap. Everything else works on a laptop.
- Nearly every feature works live in the demo. The staple-judge verdicts were computed beforehand. Only the data (the household, stores and other shoppers) is simulated. Nothing you add is kept after your visit. What the demo household contains: [`assistant/docs/DEMO.md`](assistant/docs/DEMO.md).
- **Run it yourself** with your own keys (Meta for the AI, Google Places to add stores on your own account): see [Run it yourself](docs/RUN-IT-YOURSELF.md). It has a prompt that lets [an AI agent set it up for you](docs/RUN-IT-YOURSELF.md#let-your-ai-agent-set-it-up). The [setup in the README](README.md#run-it-yourself) also works.
- **Want an account?** Sign-up is invite only while I harden the cost guard rails. Tap "Join the waitlist" on the [landing page](https://arya.teamnightshift.org) and contact me ([support@teamnightshift.org](mailto:support@teamnightshift.org) or [LinkedIn](https://www.linkedin.com/in/vibhortayal)); judges can be approved.

## Does it matter to real people? (Impact)

**What is the real-world potential?** Everyone who shops for a household does the same weekly work. They remember the list. They try not to rebuy what is in the cupboard. They wonder where the money went. A receipt has all of that, and nobody reads it. Arya reads it. It checks every line against the printed total. Then it turns the receipt into a list with reasons ([how it works](README.md#what-is-arya)). On my own 114 receipts (1,226 lines), every one passed the arithmetic check. About 4 in 5 of the staple judge's suggestions matched my own purchase rhythm (precision 0.79 against a purchase-cadence proxy; [measured results](README.md#measured-results)).

**Who benefits, and how much does it matter?** People who feed a household or a group, and share a list ([who it is for](docs/PRINCIPLES.md)). Shopping is a weekly chore and a household cost, not a rare event. I have not measured time or money saved. I tested on one household. So I do not claim a number ([Known limits](README.md#what-are-the-known-limits)).

**Could it become something people use?** It already runs. It is live, you can install it, and it is free to use. It has a demo that needs no account, shared lists for groups, a Lists API, and an MCP connector so an agent can edit your lists ([agent connector](assistant/docs/AGENT-CONNECTOR.md)). Store maps already merge across shoppers, so each trip helps the next. Shared prices are planned and not switched on. It runs as one server today. The plan to scale it is in the [roadmap](docs/ROADMAP.md). I built the base. The more people use Arya, the better it gets for them.

**Why this is built for our world:** it is a shopping problem I had myself ([why Arya exists](docs/PRINCIPLES.md)), and it is free to use. What existed before Oct 27, and a dated table of what I made in the window, are in [`docs/WHAT-WE-BUILT.md`](docs/WHAT-WE-BUILT.md).

## Which Meta models does it use, and for what? (Meta AI tooling)

Arya uses six Meta products plus the Meta Model API. Each has one job. Every call goes through one module, [`assistant/api/meta_client.py`](assistant/api/meta_client.py). The full table, with where each one is in the code, is in [`docs/quest/META-PRODUCTS.md`](docs/quest/META-PRODUCTS.md).

- Spark reads receipt photos first. Wonder re-reads a receipt only if the arithmetic checks flag it. Code: [`decode/service.py`](assistant/api/decode/service.py), [`checks.py`](assistant/api/decode/checks.py).
- Muse Spark Open (open weights, hosted on Baseten) is the second seat on the staple judge. It sees item names only. [`open_client.py`](assistant/api/open_client.py)
- SAM 3.1 draws boxes around shelf items. It pixelates the people it detects before any frame is kept. If that step fails, the frame is thrown away. Detection is not perfect, and I have not scored it. [`shelfscan.py`](assistant/api/shelfscan.py)
- Muse can use Arya. Any assistant that supports MCP can connect to Arya's MCP address. Muse is the reference client. I tested it end to end on my own Muse on 2026-11-02. It read my list, added items and filed receipts through six tools. Setup and details: [README, "Muse can use Arya"](README.md#why-i-built-it-this-way), [agent connector](assistant/docs/AGENT-CONNECTOR.md), code in [`mcp.py`](assistant/api/mcp.py).
- Available but not used: Muse Glimmer (open weights, self-hosted) and the Spark Contributor tier (cheaper, with different data terms). The reasons are in [`docs/MODELS.md`](docs/MODELS.md).
- Built with Muse Code. It wrote the first version of the engine. The Meta Muse agent on my VM (Muse Spark, which used Muse Wonder) coded in parallel with Claude. The 253 commits named "Spark" are its work. Details: [README, "How this was built"](README.md#how-this-was-built).

### Which model does which job?

| Meta product | Id | Job | Measured |
|---|---|---|---|
| Muse Spark 1.3 (Standard) | `muse-spark-1.3` | Reads receipt photos first; staple judge, Curator, Ask Arya, list and date photos, shelf labels, crop checks | 92 of 98 lines on the Wonder comparison set; staple precision 0.79. [Details](README.md#measured-results) |
| Muse Wonder 1.0 | `muse-wonder-1.0` | Re-reads a receipt the checks flag, or when Spark fails | 97 of 98 lines after hand adjudication, read alone. [Details](README.md#measured-results) |
| SAM 3.1 | via Meta Model API | Finds shelves and signs, boxes items for Find it for me, pixelates the people it detects | Used in the guided store scan |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | Dictation for the list mic and Ask Arya | n/a |
| Muse Image 1.0 | `muse-image-1.0` | The 23 grab-celebration characters (generated once) and share looks (live, per tap) | n/a |
| Muse Spark Open | `meta-models/muse-spark-open-1026` (hosted on Baseten) | Second seat of the staple judge; dictionary labels | 32 of 32 labels agree with hosted Spark; 3 of 4 staple verdicts |

Spark and Wonder run in Meta's Standard mode. The live reader is `auto` (the code default, `ARYA_PHOTO_READER=auto`). Spark reads first, and Wonder re-reads a flagged receipt. I have not yet measured the pair on photos. Every server call goes through one client with a daily spend limit. The history of the reader is in [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

The eval numbers come from one small set (9 public receipts, 98 lines). Scores change from run to run. So quote the gap between the models, not one number alone. The runs, the scorer and the hand adjudication are in [`docs/evals/`](docs/evals/).

## How is it built, and how well? (Technical depth)

- The model proposes and the code checks. Arithmetic reconciliation, returns, cadence and prices are plain code, so a rerun gives the same answer. There is a cost ledger and there are daily spend caps. The full list of claims, and where to check each one, is in the [judge playbook](docs/quest/JUDGE-PLAYBOOK.md#how-is-it-built-technical-depth).
- Why I made these choices (the idea, a PWA, the stack, hosting, the coding model and each Meta model): [README, "Why I built it this way"](README.md#why-i-built-it-this-way).
- Tests and decisions: about 1,900 Python tests and 550 web tests (as of Nov 3), and a dated [decision log](docs/DECISIONS.md).
- Read more: design decisions, what I could finish in the window and what is pending, and where it stops scaling, in [`docs/TECHNICAL-DEPTH.md`](docs/TECHNICAL-DEPTH.md).

## What does it not do yet?

- **Data.** I tested on one household's 114 receipts and a public set of 9 receipts. The measured numbers come from small samples.
- **Markets.** I built and tested with US receipts, dollars and stores first. I did not test other markets.
- **Devices.** I tested on one real iPhone. I did not test the Quest-start and live-walk location checks indoors on a real phone. A store with no stored address point cannot be checked.
- **Store maps.** No store comes pre-mapped. A store's map comes only from shoppers' guided scans.
- **Scale.** Arya runs as one server process on one VM. A few dozen people at once is about the limit ([details](README.md#what-are-the-known-limits)). Scaling it out is a plan for after judging. It is not built.
- **Demo allowance.** Each demo visit can spend about $2 on live Meta calls. The demo also has a daily cap. When either runs out, the app says so. Lists and everything that needs no live read keep working. **Use a sample receipt** still works.
- **Accounts.** Sign-up is invite only. It is for a few beta testers and hackathon judges ([how to get in](#how-do-i-try-it-demo)). The demo needs no account.
- **Licence.** Arya's own code is all rights reserved. The repository has no license file.
