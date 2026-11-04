# Judge playbook

An eight-minute path through the live demo. Each step says what to do, what you see, and which Meta model is involved. To watch the same path first, with voice and captions, see the [judge walkthrough video](https://youtu.be/cbJflgCXV5U) (3 min 48 s).

**Live demo:** https://arya.teamnightshift.org/ (no account). Use a phone, or a browser window about 390 px wide. Allow the camera and microphone for the steps that use them. The demo household is fictional. Your changes live in a sandbox for your visit only ([what is real, and what is not](../../README.md#what-is-real-and-what-is-not)).

**What you need.**

- For step 6, a grocery receipt photo. Without one, use [the sample receipt photo](../images/sample-receipt.jpg) (a real receipt of mine), tap **Use a sample receipt**, or **Skip**.
- For step 4, if you are not in a store, open [the sample shelf photo](../images/sample-shelf.jpg) (a Trader Joe's soup and broth shelf, a frame from my own video) on a second screen or a computer. Point the phone camera at it. Turn that screen to full brightness and fill the camera view with the image, to avoid glare. Any other shelf photo works too.

---

## The walk, eight minutes

### 1. Front door
Tap **Try it now**. A short sheet ("Hi, I'm Arya") offers **Show me every screen · 2 min** or **Skip for now**. You land on **Today**, with a bar at the top that says the household is a demo. Today shows your next trip, store news from the simulated town (marked Simulated), what is running low and why, and your lists.

The navigation tab at the bottom is **Today, Spending, Quest, Ask, More**. **More** holds Lists, Receipts, Stores, Help and Settings.

### 2. Lists
Tap **More**, then **Lists**. The demo has a Costcozy list and a Trader Jill's list (the town's stores have fictional names). The Trader Jill's list holds Bananas, Apples, Organic Milk, Tomato Soup and Hummus. You will look for the tomato soup with the shelf camera in step 4. Hummus is the item Demo Town reports out of stock. The other three are on the sample receipt for step 6. Due staples show under **Suggested for** the store where they are usually bought. Tap one to see why. A **Muse Spark 1.3** staple judge decides which items may be suggested (about 4 in 5 of its suggestions matched my own purchase rhythm: precision 0.79 against a purchase-cadence proxy, [details](../../README.md#measured-results)).

### 3. Add items by voice and photo
In a list, use the add row. Type an item, or tap the mic (**Muse Voice Transcribe**) and say "two gallons of milk, eggs, and blueberries". The camera (**Muse Spark** vision) reads a photo of a handwritten note. Adds apply at once, with Undo. On a laptop with no camera, type the items instead. The photo read is shown on a phone.

### 4. Start a quest
To reach Tomato soup, start from the Trader Jill's list: **More**, **Lists**, open it, tap **Start shopping**, then on the Quest tab tap **Start at Trader Jill's**. (On Today, **Start shopping** on the next trip also works, if that trip is Trader Jill's.) The quest opens at that list's store.

- An unmapped store plays as a labelled typical layout ("A guess, not a pin").
- Tap **Got it**: +10 points (the Golden item is worth double). The celebration characters were painted with **Muse Image**. There is no clock and no way to lose.
- When you reach **Tomato soup**, tap **Can't find it**, then **Find it for me**. Aim the camera at the shelf (or at the sample shelf photo). **SAM 3.1** boxes candidates and **Muse Spark** checks each crop. Look for the highlight on a soup carton. If it lands elsewhere, try again closer. From the same place, **The shelf is empty** tells other Arya shoppers it is gone.
- **Map my store** (on the Quest tab) opens the guided scan. Pan along the shelves. SAM 3.1 pixelates the people it detects, and Muse Spark reads sections, aisle signs and prices.

### 5. Ask Arya
Open **Ask**. Type "What am I running low on?", then "We finished the Greek yogurt." The answer comes from the household data. The stated fact becomes an action that the server validates before it applies.

### 6. Finish with a receipt
When the list is done, tap **Head to checkout**, then **Add your receipt**. **Snap the receipt** with a photo, or tap **Use a sample receipt**. Behind the screen, **Muse Spark** reads each line, in Meta's Standard mode, and code checks that the lines add up to the printed total. If Spark fails, or the checks flag the read (the lines do not add up, or too many lines are unsure), **Muse Wonder 1.0** reads the receipt again. The screen names the model only when the checks flag a read: "Read by Muse Spark · checking", then "Checked by Muse Wonder" or "Read by Muse Wonder". A clean Spark read shows no model name. The demo reads the receipt but keeps nothing. Use a sample receipt if you would rather not send one.

**With the sample receipt.** Download [the sample receipt photo](../images/sample-receipt.jpg) (Trader Joe's, Milpitas, Nov 3, 2026; it is my own receipt). It matches the demo's **Trader Jill's** list: bananas, apples and organic milk are on the receipt. Tomato soup is the one you find with the shelf camera, and hummus is the item Demo Town reports out of stock, so neither is on the receipt. On a laptop, pick the file after tapping **Snap the receipt**. On a phone, save it to Photos first. A read takes about 30 seconds, or up to about 90 when Muse Wonder re-reads it. Expect 3 lines (organic milk $4.49, 2 apples $2.38, 2 bananas $0.58) and a total of $7.45 with no tax. Tap **Looks right** to accept the read. The filed receipt, under **More**, **Receipts**, shows **Total checks out**. The sample is built by code, so no model name shows. The card number, auth codes and cashier name are blurred. The receipt is dated before your trip. A real account refuses that. The demo accepts it and says so on screen ("Demo only: this receipt is dated ..., before this trip began"). How the readers score on a public set: [`docs/evals/`](../evals/).

---

## What if something fails?

| Symptom | What to do |
| --- | --- |
| "demo rate limit" | Wait a minute and retry. |
| "You've used this demo visit's live reads" | The visit's share (about $2) is spent. Lists, Today, Spending and the rest keep working, and **Use a sample receipt** still works. Only the live reads (receipt, photo, voice, Ask) pause. |
| "The demo's live reads are paused for today" | The demo's shared daily budget is used up. The rest is the same as above. The real app has its own daily budget, so judges cannot use it up. |
| Receipt spinner over 90 s | A receipt that Muse Wonder re-reads can take up to about 90 seconds. Wait, or Skip. |
| Voice gives nothing | Check microphone permission, or type. |
| Page looks stale | Reload twice, or clear site data. |

## What do I do when I am done?

Tap **Finish demo** (top right) to leave feedback, replay the tour or see the code.

---

## Does it matter to real people? (Impact)

The four rubric questions are answered on [the judges page, Impact](../../JUDGES.md#does-it-matter-to-real-people-impact).

## How is it built? (Technical depth)

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
- Friends, the Store and Global boards, and Shop-Off and Spotter reports show only your own account's data (plus labelled samples), in the real app too. Shelf-empty reports are shared between shoppers in the real app (three shoppers must report the same item at a store, and only shoppers with that item on their list see it). A demo report reaches no one, because the demo writes to its own sandbox.
- Open weights are used in one place: Muse Spark Open (hosted on Baseten) is the second seat of the staple judge. It sees item names only, never personal data. Glimmer is not used.

Everything else it does not do yet, for the real app too: [the judges page, "What does it not do yet?"](../../JUDGES.md#what-does-it-not-do-yet).
