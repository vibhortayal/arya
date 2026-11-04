# Judge playbook

An eight-minute path through the live demo. Each step says what to do, what you see, and which Meta model is involved.

**Live demo:** https://arya.teamnightshift.org/ (no account). Use a phone, or a browser window about 390 px wide. Allow the camera and microphone for the steps that use them. The demo household is fictional, and your changes live in a sandbox for your visit only ([what is real, and what is not](../../README.md#what-is-real-and-what-is-not)).

**What you need.**

- For step 6, a grocery receipt photo. Without one, use [the sample receipt photo](../images/sample-receipt.jpg) (a real receipt of mine), tap **Use a sample receipt**, or **Skip**.
- For step 4, if you are not in a store, open [the sample shelf photo](../images/sample-shelf.jpg) (a Trader Joe's soup and broth shelf, a frame from my own video) on a second screen or a computer and point the phone camera at it. Turn that screen to full brightness and fill the camera view with the image, to avoid glare. Any other shelf photo works too.

---

## The walk, eight minutes

### 1. Front door
Tap **Try it now**. A short sheet ("Hi, I'm Arya") offers **Show me every screen · 2 min** or **Skip for now**. You land on **Today**, with a bar at the top that says the household is a demo. Today shows your next trip, store news from the simulated town (marked Simulated), what is running low and why, and your lists.

The navigation tab at the bottom is **Today, Spending, Quest, Ask, More**. **More** holds Lists, Receipts, Stores, Help and Settings.

### 2. Lists
Tap **More**, then **Lists**. The demo has a Costcozy list and a Trader Jill's list (the town's stores have fictional names). Due staples show under **Suggested for** the store where they are usually bought; tap one to see why. A **Muse Spark 1.3** staple judge decides which items may be suggested (about 4 in 5 of its suggestions were items I really do rebuy: precision 0.79 against my own purchase rhythm, [details](../../README.md#measured-results)).

**Before you shop (step 4), add "Tomato soup"** to the Trader Jill's list: type it in the add row. You will look for it with the shelf camera.

### 3. Add items by voice and photo
In a list, use the add row: type an item, or tap the mic (**Muse Voice Transcribe**) and say "two gallons of milk, eggs, and blueberries"; the camera (**Muse Spark** vision) reads a photo of a handwritten note. Adds apply at once, with Undo. On a laptop with no camera, type the items instead; the photo read is shown on a phone.

### 4. Start a quest
To reach Tomato soup, start from the Trader Jill's list: **More**, **Lists**, open it, tap **Start shopping**, then pick **Start a Quest**. (On Today, **Start shopping** on the next trip also works, if that trip is Trader Jill's.) The quest opens at that list's store.

- An unmapped store plays as a labelled typical layout ("A guess, not a pin").
- Tap **Got it**: +10 points (the Golden item is worth double). The celebration characters were painted with **Muse Image**. There is no clock and no way to lose.
- When you reach **Tomato soup**, tap **Can't find it**, then **Find it for me**: aim the camera at the shelf (or at the sample shelf photo), **SAM 3.1** boxes candidates and **Muse Spark** checks each crop. Look for the highlight on a soup carton; if it lands elsewhere, try again closer. From the same place, **The shelf is empty** tells other Arya shoppers it is gone.
- **Map my store** (on the Quest tab) opens the guided scan: pan along the shelves, SAM 3.1 pixelates the people it detects, and Muse Spark reads sections, aisle signs and prices.

### 5. Ask Arya
Open **Ask**. Type "What am I running low on?", then "We finished the Greek yogurt." The answer comes from the household data. The stated fact becomes an action that the server validates before it applies.

### 6. Finish with a receipt
When the list is done, tap **Head to checkout**, then **Add your receipt**. **Snap the receipt** with a photo, or tap **Use a sample receipt**. **Muse Spark** reads each line, in Meta's Standard mode, and code checks that the lines add up to the printed total. If Spark fails, or the checks flag the read (the lines don't add up, or too many lines are unsure), **Muse Wonder 1.0** reads the receipt again. Arya records which model read the receipt. The demo reads the receipt but keeps nothing; use a sample receipt if you would rather not send one.

**With the sample receipt.** Download [the sample receipt photo](../images/sample-receipt.jpg) (India Bazaar, Nov 1, 2026; it is my own receipt, and it shows the last four digits of my card, which I left in). On a laptop, pick the file after tapping **Snap the receipt**; on a phone, save it to Photos first. A read takes about 10 seconds, or about 45 when Muse Wonder re-reads it. Expect 13 lines, a subtotal of $56.63, tax $0.57 and a total of $57.20, with **Total checks out** and the model that read it shown. The names come back shortened. How the readers score on a public set: [`docs/evals/`](../evals/).

---

## What if something fails?

| Symptom | What to do |
| --- | --- |
| "demo rate limit" | Wait a minute and retry. |
| "You've used this demo visit's live reads" | The visit's share (about $0.40) is spent. Lists, Today, Spending and the rest keep working; use the sample buttons for receipt, photo, voice and Ask. |
| "The demo's live reads are paused for today" | The demo's shared daily budget is used up; same as above. The real app has its own daily budget, so judges cannot use it up. |
| Receipt spinner over 90 s | A receipt that needs the Wonder re-read can take up to 90 seconds. Wait, or Skip. |
| Voice gives nothing | Check microphone permission, or type. |
| Page looks stale | Reload twice, or clear site data. |

## What do I do when I am done?

Tap **Finish demo** (top right) to leave feedback, replay the tour or see the code.

---

## Does it matter to real people? (Impact, 30%)

The four rubric questions are answered on [the judges page, Impact](../../JUDGES.md#does-it-matter-to-real-people-impact-30).

## How is it built? (Technical depth, 20%)

| Claim | Where to verify |
| --- | --- |
| One module calls the Meta API | [`meta_client.py`](../../assistant/api/meta_client.py) |
| Receipts verified by arithmetic | [`test_receipt_math.py`](../../assistant/tests/test_receipt_math.py) |
| Demo writes never reach disk | `state.set_overlay` in [`state.py`](../../assistant/api/state.py); sandbox tests |
| People are pixelated before a frame is kept | `shelfscan.scrub_people` in [`shelfscan.py`](../../assistant/api/shelfscan.py) (fails closed) |
| Model proposes, code checks: arithmetic reconciliation, returns, cadence and prices are deterministic | [`ARCHITECTURE.md`](../../assistant/docs/ARCHITECTURE.md) |
| Cheapest model that holds the score, with a ledger, a rate gate and daily spend caps | [`MODEL-POLICY.md`](../../assistant/docs/MODEL-POLICY.md) |
| Measured results, small samples, stated in Known limits | [`docs/evals/`](../evals/), [README, Known limits](../../README.md#what-are-the-known-limits) |
| Open API and docs | https://arya.teamnightshift.org/developers |
| Outside services: the Google Places API finds stores for the store picker; Supabase, Resend and Baseten | [README, Built with](../../README.md#built-with) |
| Tests | `cd assistant && python -m unittest discover -s tests`; known failures in [`STATUS.md`](../../STATUS.md). CI is manual-only (`.github/workflows/tests.yml`) |
| How the build was run (roles, hard rules, review and test gates) | [`AGENTS.md`](../../AGENTS.md) |
| Build diary, one log per work session | [`assistant/loops/`](../../assistant/loops/); how the early commits arrived fast: [README, "How this was built"](../../README.md#how-this-was-built) |

Read more: design decisions, what I could finish in the window and what is pending, and where it stops scaling, in [`docs/TECHNICAL-DEPTH.md`](../TECHNICAL-DEPTH.md).

## What is not in the demo?

- Imports and batch jobs are switched off in the demo (bulk receipt imports, PDF and text decode, the Curator and staple-judge batch runs).
- Friends and the leaderboards show one account's data in the demo. Shelf-empty reports are shared between shoppers in the real app (three shoppers must report the same item at a store, and only shoppers with that item on their list see it), but a demo report reaches no one, because the demo writes to its own sandbox.
- Open weights are used in one place: Muse Spark Open (hosted on Baseten) is the second seat of the staple judge. It sees item names only, never personal data. Glimmer is not used.

Everything else it does not do yet, for the real app too: [the judges page, "What does it not do yet?"](../../JUDGES.md#what-does-it-not-do-yet).
