# For judges

**Problem statement: Build for Your World.**

Arya learns how you shop from your receipts and helps shoppers help each other. Indie track, solo. Build window:
Oct 27 to Nov 4, 2026.

Theme fit: a tool for everyday life that depends on Meta's models for reading receipts, labels, voice and shelves. The model map below shows which model does which job.

- **Why this is built for our world:** a shopper's problem I had personally, and free to use. [`README.md`](README.md#what-is-arya), [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md)
- **Built in the hackathon window:** what existed before Oct 27, and a dated table of what I made. [`docs/WHAT-WE-BUILT.md`](docs/WHAT-WE-BUILT.md)
- **Try it, no sign-up:** https://arya.teamnightshift.org, then tap "Try it now". It opens a fictional household in a sandbox that exists for your visit only. Best on a phone; on a laptop, make the window about 390 px wide. Camera steps need a phone.
- **Demo video (3 min):** recorded after the Nov 3 freeze and linked here then. The live demo and the path below work without it.
- **Guided path through the app:** [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md), with a [sample receipt photo](docs/images/sample-receipt.jpg) to try in step 6
- **Where it was tested:** Built and tested with US receipts, dollars and stores first; other markets not tested.
- **Stage 1 (really uses Meta models):** every intelligent step is a Meta model, and every call goes through one module, [`assistant/api/meta_client.py`](assistant/api/meta_client.py).
- **Why these choices:** the idea, PWA (a website you add to your phone's Home Screen), stack, hosting, coding model and each Meta model: [`README.md`](README.md#why-i-built-it-this-way)
- **Depth:** about 1,800 Python and 500 web tests (as of Nov 2), and a dated [decision log](docs/DECISIONS.md).

## How does this fit the Indie track?

- **Creative:** Arya reads your receipts to run your list, and Quest turns the shop into a game.
- **Technically ambitious:** six Meta models with one job each, receipt arithmetic checked in plain code, and an MCP connector so an agent can edit your lists.
- **Does it work:** it is live at [arya.teamnightshift.org](https://arya.teamnightshift.org) and the demo needs no account. Nearly every feature works live in the demo (the staple-judge verdicts were computed beforehand, and nothing you add is kept past your visit); only the data (the household, stores and other shoppers) is simulated. I have not opened sign-up yet because I am still hardening the cost guard rails; [how to try it](#how-do-i-try-it-demo-25) lists the ways in. The measured numbers and their limits are in [Measured results](README.md#measured-results) and [Known limits](README.md#what-are-the-known-limits).

## Does it matter to real people? (Impact, 30%)

**What is the real-world potential?** Everyone who shops for a household does the same weekly work: remembering the list, not rebuying what is in the cupboard, and wondering where the money went. A receipt holds all of that and nobody reads it. Arya reads it, checks every line against the printed total, and turns it into a list with reasons ([how it works](README.md#what-is-arya)). On my own 114 receipts (1,226 lines) every one passed the arithmetic check, and the staple judge's precision was 0.79 against a purchase-cadence proxy ([measured results](README.md#measured-results)).

**Who benefits, and how much does it matter?** People who keep a household or a group fed, and share a list ([who it is for](docs/PRINCIPLES.md)). It matters as a weekly chore and a household budget, not as a rare event. I have not measured time or money saved, and I tested on one household, so I do not claim a number ([Known limits](README.md#what-are-the-known-limits)).

**Could it become something people use?** It already runs: live at arya.teamnightshift.org, installable, free to use, with a no-account demo, shared lists for groups, a Lists API and an MCP connector so an agent can edit your lists ([agent connector](assistant/docs/AGENT-CONNECTOR.md)). Store maps already merge across shoppers, so each trip helps the next; shared prices are planned and not switched on. It runs as one server today, and the plan to scale it is in the [roadmap](docs/ROADMAP.md). Rome wasn't built in a day: I built the foundation, and the more people use Arya the better it gets for them.

**Does it fit a problem statement?** Yes. It is a shopper's problem I had personally ([why](docs/PRINCIPLES.md)).

## Which Meta models does it use, and for what? (Meta AI tooling, 25%)

Six Meta products plus the Meta Model API, each with a job (the model map is below). The full table with where each lives in code: [`docs/quest/META-PRODUCTS.md`](docs/quest/META-PRODUCTS.md).

- Spark reads receipt photos first; Wonder re-reads only a receipt the arithmetic checks flag. Code: [`decode/service.py`](assistant/api/decode/service.py), [`checks.py`](assistant/api/decode/checks.py).
- Muse Spark Open (open weights, hosted on Baseten) is a second seat on the staple judge; it sees item names only. [`open_client.py`](assistant/api/open_client.py)
- SAM 3.1 boxes shelf items and pixelates the people it detects before any frame is kept; if that step fails the frame is discarded. Detection is not perfect and has not been scored. [`shelfscan.py`](assistant/api/shelfscan.py)
- Muse can use Arya: any MCP-capable assistant connects to Arya's MCP address, and Muse is the reference client. I tested it end to end on my own Muse on 2026-11-02: I asked the Muse agent to connect, pasted the code into the secure credentials vault Muse opened (never the chat), and Muse then read my list, added items and filed receipts through six tools. [Agent connector](assistant/docs/AGENT-CONNECTOR.md), code in [`mcp.py`](assistant/api/mcp.py)
- Available but not used: Muse Glimmer (open weights, self-hosted) and the Spark Contributor tier (cheaper, different data terms). Reasons: [`docs/MODELS.md`](docs/MODELS.md).
- Built with Muse Code: it wrote the first version of the engine. The Meta Muse agent on my VM (Muse Spark, which used Muse Wonder) coded in parallel with Claude, and the 253 commits named "Spark" are its work. Details: [README, "How this was built"](README.md#how-this-was-built).

## How is it built, and how well? (Technical depth, 20%)

- Design decisions, what I could finish in the window and what is pending, and where it stops scaling: [`docs/TECHNICAL-DEPTH.md`](docs/TECHNICAL-DEPTH.md)
- Model proposes, code checks: arithmetic reconciliation, returns, cadence and prices are deterministic. [`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md)
- Cheapest model that holds the score, with a ledger, a rate gate and daily spend caps. [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md)
- Measured results with the files behind them: [`docs/evals/`](docs/evals/). Small samples, stated in [Known limits](README.md#what-are-the-known-limits).
- Open API and docs: https://arya.teamnightshift.org/developers
- Outside services: the Google Places API finds stores for the store picker; Supabase, Resend and Baseten are listed in the [README](README.md#built-with).
- Tests: commands in the [README](README.md#run-it-yourself); known failures in [`STATUS.md`](STATUS.md). CI is manual-only (`.github/workflows/tests.yml`).
- How the build was run (roles, hard rules, review and test gates): [`AGENTS.md`](AGENTS.md).
- Build diary, one log per work session: [`assistant/loops/`](assistant/loops/). How the early commits arrived fast: [README, "How this was built"](README.md#how-this-was-built).

## How do I try it? (Demo, 25%)

- The same loop as the video plays live: Today, Lists, Ask ("We finished the Greek yogurt"), Start shopping. [`README.md`](README.md#try-it-in-one-minute)
- Steps that need a phone camera or mic: voice add, photo of a note, Find it for me, Map my store, receipt snap.
- What the demo household contains: [`assistant/docs/DEMO.md`](assistant/docs/DEMO.md).
- To go past the demo, run it locally with your own key ([Run it yourself](docs/RUN-IT-YOURSELF.md), which includes a prompt for an AI agent to [set it up for you](docs/RUN-IT-YOURSELF.md#let-your-ai-agent-set-it-up), or the [setup in the README](README.md#run-it-yourself)), or tap "Join the waitlist" on the [landing page](https://arya.teamnightshift.org) and reach out to me to get approved: [support@teamnightshift.org](mailto:support@teamnightshift.org), or [LinkedIn](https://www.linkedin.com/in/vibhortayal).

## Which model does which job?

| Meta product | Id | Job | Measured |
|---|---|---|---|
| Muse Spark 1.3 (Standard) | `muse-spark-1.3` | Reads receipt photos first; staple judge, Curator, Ask Arya, list and date photos, shelf labels, crop checks | 92 of 98 lines on the Wonder comparison set; staple precision 0.79. [Details](README.md#measured-results) |
| Muse Wonder 1.0 | `muse-wonder-1.0` | Re-reads a receipt the checks flag, or when Spark fails | 97 of 98 lines after hand adjudication, read alone. [Details](README.md#measured-results) |
| SAM 3.1 | via Meta Model API | Finds shelves and signs, boxes items for Find it for me, pixelates the people it detects | Used in the guided store scan |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | Dictation for the list mic and Ask Arya | n/a |
| Muse Image 1.0 | `muse-image-1.0` | The 23 grab-celebration characters (generated once) and share looks (live, per tap) | n/a |
| Muse Spark Open | `meta-models/muse-spark-open-1026` (hosted on Baseten) | Second seat of the staple judge; dictionary labels | 32 of 32 labels agree with hosted Spark; 3 of 4 staple verdicts |
| Auto reader (the live path) | `ARYA_PHOTO_READER=auto` (the default) | Spark first; Wonder re-reads a flagged receipt | Not yet measured on photos. A swapped pair of prices keeps the sum, so the review queue stays |
| Meta Model API | one client | Every server call, with a daily spend ceiling | n/a |

Spark and Wonder run in Meta's Standard mode. The live reader is `auto` (the code default). Reader history is in [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

Eval numbers: the automatic scorer gives Wonder 86 of 98 (87.8%), below Spark's 92 of 98; after hand adjudication Wonder is 97 of 98. The same Spark scored 90 of 98 in the earlier Gate 0 run and 92 of 98 in the Wonder comparison: that is run-to-run variance on one small set, so quote the gap between the models, not either number alone. See [`docs/evals/`](docs/evals/).

## What does it not do yet?

Tested on one household's 114 receipts and a 9-receipt public set. Real-device testing was on one iPhone. Arya runs as one server process on one VM, so a few dozen people at once is about the limit (details in [Known limits](README.md#what-are-the-known-limits)); scaling it out is a plan for after judging, not built. Sign-up is invite only, for a few beta testers, and access can be given to hackathon judges: reach out ([how to try it](#how-do-i-try-it-demo-25)). The demo needs no account. The licence is all rights reserved; see [`LICENSE`](LICENSE).
