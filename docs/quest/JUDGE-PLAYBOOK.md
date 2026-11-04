# Judge playbook

An eight-minute path through the live demo, grouped by the judging
criteria. Each step says what to do, what you see, and which Meta model
is involved.

**Live demo:** https://arya.teamnightshift.org/ (no account). Use a phone,
or a browser window about 390 px wide. Allow the camera and microphone
for the steps that use them.

**What is real.** The demo household is fictional. Your changes live in
an in-memory sandbox for your visit only; nothing reaches disk or
another visitor. No store ships pre-mapped: a store's map comes only
from shoppers' guided scans, with people pixelated by SAM first. Camera,
microphone and chat call the Meta API live, within a small per-visit allowance. If the allowance or the day's cap is used up, the app says so; the sample buttons still work.

**Known limits.** One household's data and one real phone: see [Known limits](../../README.md#what-are-the-known-limits).

**What you need.** A grocery receipt photo for step 6. Without one, use
[the sample receipt photo](../images/sample-receipt.jpg) (a real receipt of
mine), tap **Use a sample receipt**, or **Skip**. For the shelf step (4),
have [the sample shelf photo](../images/sample-shelf.jpg) open on a second
screen or a computer.

---

## How do I walk through the demo? (Demo, 25%)

### 1. Front door
Tap **Try it now**. A short sheet ("Hi, I'm Arya") offers **Show me every
screen · 2 min** or **Skip for now**. You land on **Today**, with a bar at
the top that says the household is a demo. Today shows your next trip,
store news from the simulated town (marked Simulated), what is running
low and why, and your lists.

The navigation tab at the bottom is **Today, Spending, Quest, Ask, More**. **More**
holds Lists, Receipts, Stores, Help and Settings.

### 2. Lists
Tap **More**, then **Lists**. The demo has a Costcozy list and a Trader Jill's list
(the town's stores have fictional names). Due staples show under
**Suggested for** the store where they are usually bought; tap one to
see why. **Before you shop (step 4), add "Tomato soup"** to the Trader Jill's
list: type it in the add row. You will look for it with the shelf camera. A **Muse Spark 1.3**
staple judge decides which items may be suggested (precision 0.79
against a purchase-cadence proxy on my receipts).

---

## Which Meta models can I see working? (Meta tooling, 25%)

### 3. Add items by voice and photo
In a list, use the add row: type an item, or tap the mic (**Muse Voice Transcribe**) and say
"two gallons of milk, eggs, and blueberries"; the camera (**Muse Spark**
vision) reads a photo of a handwritten note. Adds apply at once, with
Undo. On a laptop with no camera, type the items instead; the photo read is shown on a phone.

### 4. Start a quest
To reach Tomato soup, start from the Trader Jill's list: **More**, **Lists**,
open it, tap **Start shopping**, then pick **Start a Quest**. (On Today,
**Start shopping** on the next trip also works, if that trip is Trader Jill's.)
The quest opens at that list's store.

- An unmapped store plays as a labelled typical layout ("A guess, not a
  pin").
- Tap **Got it**: +10 points (the Golden item is worth double). The
  celebration characters were painted with **Muse Image**. There is no
  clock and no way to lose.
- **I can't find it** offers **Find it for me**: the camera aims at the
  item, **SAM 3.1** boxes candidates and **Muse Spark** checks each crop.
  Not in a store? When you reach **Tomato soup**, open
  [the sample shelf photo](../images/sample-shelf.jpg) (a Trader Joe's soup
  and broth shelf, a frame from my own video) on a second screen or a computer, tap
  **I can't find it**, then **Find it for me**, and point the phone camera at
  that screen. Look for the highlight on a soup carton; if it
  lands elsewhere, try again closer to the screen. For a clean read, turn the screen to full brightness
  and fill the camera view with the image, to avoid glare. Any other shelf
  photo works too.
  From the same place you can tell other Arya shoppers it is gone.
- **Map my store** (on the Quest tab) opens the guided scan: pan along
  the shelves, SAM 3.1 pixelates the people it detects, and Muse Spark reads sections,
  aisle signs and prices.

### 5. Ask Arya
Open **Ask**. Type "What am I running low on?", then "We finished the
Greek yogurt." The answer comes from the household data. The stated fact
becomes an action that the server validates before it applies.

### 6. Finish with a receipt
When the list is done, tap **Head to checkout**, then **Add your
receipt**. **Snap the receipt** with a photo, or tap **Use a sample
receipt**. **Muse Spark** reads each line, and code checks that the lines add up
to the printed total. If Spark fails, or the checks flag the read (the
lines don't add up, or too many lines are unsure), **Muse Wonder 1.0**
reads the receipt again. Arya records which model read the receipt. On
the Gate 0 public set, Wonder alone got 97 of 98 lines right after hand
adjudication, with zero price errors.
A snapped receipt is read live by Muse Spark in Meta's Standard mode. Use a sample receipt if you would rather not send one.

**Try the sample receipt.** Download [the sample receipt photo](../images/sample-receipt.jpg)
(India Bazaar, Nov 1, 2026; it is my own receipt). On a laptop, pick the file
after tapping **Snap the receipt**; on a phone, save it to Photos first. A
read takes about 10 seconds, or about 45 when Muse Wonder re-reads it. Expect
13 lines, a subtotal of $56.63, tax $0.57 and a total of $57.20, with **Total
checks out** and the model that read it shown. The names come back shortened.
In three live runs on Nov 2 every price matched the printed receipt; one run
was re-read by Muse Wonder. The receipt shows the last four digits of my card,
which I left in. The demo reads the receipt but keeps nothing.

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
| Cost policy | `assistant/docs/MODEL-POLICY.md` |
| Measured results | `README.md`, "Measured results" |
| Tests | `cd assistant && python -m unittest discover -s tests` |

## What does it not do yet?

- **Markets.** Built and tested with US receipts, dollars and stores first; other markets not tested.
- No store ships pre-mapped; maps come from shoppers' scans.
- Open weights are used in one place: Muse Spark Open (hosted on Baseten) is the
  second seat of the staple judge. It sees item names only, never
  personal data. Glimmer is not used.
- Closed in the demo: bulk imports, PDF and text decode, Curator runs
  and judge runs.
- Friends, the boards and Shop-Off and Spotter reports stay inside one account. You can add a friend by handle, but the Friends, Store and Global boards show only your own account's data (plus labelled samples), and the demo is a single account. "Not here" reports are shared across shoppers (three different shoppers must report the same item at a store, and only shoppers with that item on their list see it), but the demo writes to its own sandbox, so a demo report reaches no one.
- Live calls can be slow (a receipt that needs the Wonder re-read can take up to 90 seconds). A daily budget
  and a per-IP limit protect the account. If a gate is hit, nothing breaks: a demo visit
  that spends its share ($0.40) says "You've used this demo visit's live reads", and when
  the demo's shared daily budget runs out it says "The demo's live reads are paused for
  today". Lists, Today, Spending and the rest keep working; only the live AI reads (receipt,
  photo, voice, Ask) pause. The real app has its own $10 daily budget, so a crowd of
  judges cannot use it up.

## What do I do when I am done?

Tap **Finish demo** (top right) to leave feedback, replay the tour or see
the code.

## What if something fails?

| Symptom | What to do |
| --- | --- |
| "demo rate limit" | Wait a minute and retry. |
| Receipt spinner over 90 s | Wait, or Skip. |
| Voice gives nothing | Check microphone permission, or type. |
| Page looks stale | Reload twice, or clear site data. |
