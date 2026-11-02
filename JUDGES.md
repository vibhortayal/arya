# For judges

Arya is a grocery list that learns from your receipts. Built for the Meta Global AI
Developer Hackathon 2026, Indie track, solo. Build window: Oct 27 to Nov 4, 2026.

- **Try it, no sign-up:** https://arya.teamnightshift.org, then tap "Try it now". It opens a fictional household in a sandbox that exists for your visit only. Best on a phone; on a laptop, make the window about 390 px wide. Camera steps need a phone.
- **Demo video (3 min):** VIDEO_LINK_PLACEHOLDER
- **Guided path through the app:** [`docs/quest/JUDGE-PLAYBOOK.md`](docs/quest/JUDGE-PLAYBOOK.md)
- **Stage 1 (really uses Meta models):** every intelligent step is a Meta model, and every call goes through one module, [`assistant/api/meta_client.py`](assistant/api/meta_client.py).

## Impact (30%)

- A list that writes itself: running low, use soon, and where you usually buy it, each with a reason. [`README.md`](README.md#what-is-in-it)
- Receipts are read, then every line is checked against the printed total in plain code; returns net out. [`assistant/docs/SPEC.md`](assistant/docs/SPEC.md)
- Add by typing, voice, a photo of a note, or your own AI assistant through the MCP connector. [`assistant/docs/AGENT-CONNECTOR.md`](assistant/docs/AGENT-CONNECTOR.md)
- Quest, an optional game, turns the trip into a hunt with no clock and no way to lose. [`docs/quest/GAME-DESIGN.md`](docs/quest/GAME-DESIGN.md)
- Who it is for and why: [`docs/quest/BUSINESS.md`](docs/quest/BUSINESS.md)

## Use of Meta AI tooling (25%)

Six Meta products plus the Meta Model API, each with a job (the model map is below). The full table with where each lives in code: [`docs/quest/META-PRODUCTS.md`](docs/quest/META-PRODUCTS.md).

- Spark reads receipt photos first; Wonder re-reads only a receipt the arithmetic checks flag. Code: `assistant/api/decode/service.py`, `checks.py`.
- Muse Spark Open (open weights, hosted on Baseten) is a second seat on the staple judge; it never sees personal data. `assistant/api/open_client.py`
- SAM 3.1 boxes shelf items and blurs every person before any frame is kept. `assistant/api/shelfscan.py`
- Not used, said plainly: Muse Glimmer and Muse Code.

## Technical depth and execution (20%)

- Model proposes, code checks: arithmetic reconciliation, returns, cadence and prices are deterministic. [`assistant/docs/ARCHITECTURE.md`](assistant/docs/ARCHITECTURE.md)
- Cheapest model that holds the score, with a ledger, a rate gate and daily spend caps. [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md)
- Measured results with the files behind them: [`docs/evals/`](docs/evals/). Small samples, stated in [Known limits](README.md#known-limits).
- Open API and docs: https://arya.teamnightshift.org/developers
- Tests: commands in the [README](README.md#run-it-yourself); current counts and known failures in [`STATUS.md`](STATUS.md). CI is manual-only (`.github/workflows/tests.yml`).
- Build diary, one log per work session: [`assistant/loops/`](assistant/loops/). How the early commits arrived fast: [README, "How this was built"](README.md#how-this-was-built).

## Demo (25%)

- The same loop as the video plays live: Today, Lists, Ask ("We finished the Greek yogurt"), Start shopping. [`README.md`](README.md#try-it-in-one-minute)
- Steps that need a phone camera or mic: voice add, photo of a note, Find it for me, Map this store, receipt snap.
- What the demo household contains: [`assistant/docs/DEMO.md`](assistant/docs/DEMO.md).

## Meta model map

| Meta product | Id | Job | Measured |
|---|---|---|---|
| Muse Spark 1.3 (Standard) | `muse-spark-1.3` | Reads receipt photos first; staple judge, Curator, Ask Arya, list and date photos, shelf labels, crop checks | 92 of 98 lines on the Wonder comparison set (90 of 98 in the earlier Gate 0 run); staple judge precision 0.79 |
| Muse Wonder 1.0 | `muse-wonder-1.0` | Re-reads a receipt the checks flag, or when Spark fails | 97 of 98 lines after hand adjudication, zero price errors, read alone |
| SAM 3.1 | via Meta Model API | Finds shelves and signs, boxes items for Find it for me, blurs people | Used in the guided store scan |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | Dictation for the list mic and Ask Arya | n/a |
| Muse Image 1.0 | `muse-image-1.0` | The 20 grab-celebration characters, generated once | n/a |
| Muse Spark Open | `meta-models/muse-spark-open-1026` (hosted on Baseten) | Second seat of the staple judge; dictionary labels | 32 of 32 labels agree with hosted Spark; 3 of 4 staple verdicts |
| Meta Model API | one client | Every server call, with a daily spend ceiling | n/a |

Spark and Wonder run in Meta's Standard mode, which Meta does not use to train its models. The live receipt reader is `auto` (the code default): Spark first, Wonder on a flagged read. Reader history is in [`assistant/docs/MODEL-POLICY.md`](assistant/docs/MODEL-POLICY.md).

Eval numbers: the automatic scorer gives Wonder 87 of 98 and Spark 92 of 98; after hand adjudication Wonder is 97 of 98. See [`docs/evals/`](docs/evals/).

## Honest limits

Tested on one household's 114 receipts and a 9-receipt public set. Real-device testing was on one iPhone. Registration is closed; the demo needs no account. The licence is all rights reserved; see [`LICENSE`](LICENSE).
