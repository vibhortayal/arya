# Judge playbook

An eight-minute path through the live demo, grouped by the judging
criteria. Each step says what to do, what you see, and which Meta model
is involved.

**Live demo:** https://arya-pilot.duckdns.org/ (no account). Use a phone,
or a browser window about 390 px wide. Allow the camera and microphone
for the steps that use them.

**What is real.** The demo household is fictional. Your changes live in
an in-memory sandbox for your visit only; nothing reaches disk or
another visitor. No store ships pre-mapped: a store's map comes only
from shoppers' guided scans, with people blurred by SAM first. Camera,
microphone and chat call the Meta API live.

**What you need.** A grocery receipt photo for step 6. Without one, tap
**Use a sample receipt** or **Skip**.

---

## Demo (25%)

### 1. Front door
Tap **Try it now**. You land on **Today** with a bar that says the
household is a demo. Today lists what is running low and why, store
alerts, and what to use soon.

### 2. Lists
Open **Lists**. The demo has a Costco list and a Trader Joe's list.
Due staples show as suggestions under the list of the store where they
are usually bought, with a reason and a "why" sheet. A **Muse Spark 1.3**
staple judge decides which items may be suggested (precision 0.79
against a purchase-cadence proxy on the owner's receipts).

---

## Meta tooling (25%)

### 3. Add items by voice and photo
In a list, use the add row: the mic (**Muse Voice Transcribe**) takes
"two gallons of milk, eggs, and blueberries"; the camera (**Muse Spark**
vision) reads a photo of a handwritten note. Adds apply at once, with
Undo.

### 4. Start a quest
Open a list and tap **Start shopping**. The quest opens at that list's
store. **How to play** shows once.

- An unmapped store plays as a labelled typical layout.
- Tap **Grab**: +10 points and a character painted with **Muse Image**.
  There is no clock and no way to lose.
- **Find it for me** opens the camera aimed at the next item. **SAM 3.1**
  boxes candidates and **Muse Spark** checks each crop. Point it at any
  shelf photo on a second screen if you are not in a store.
- **Not here?** files a shortage report for the next shopper.
- **Map this store** (on the Quest home) opens the guided scan: pan along
  the shelves, SAM 3.1 blurs every person, and Muse Spark reads sections,
  aisle signs and prices.

### 5. Ask Arya
Open **Ask**. Type "What am I running low on?", then "We finished the
Greek yogurt." The answer comes from the household data. The stated fact
becomes an action that the server validates before it applies.

### 6. Finish with a receipt
Tap **I'm done shopping**, then **Snap the receipt**. **Muse Wonder 1.0**
reads each line, and code checks that the lines add up to the printed
total. If Wonder takes more than 90 seconds, Arya falls back to Muse
Spark and records which model read the receipt. On the Gate 0 public set,
Wonder got 97 of 98 lines right after hand adjudication, with zero price
errors.

---

## Impact (30%)

- **Who:** households that shop every week. Families get a list that
  writes itself, and a quest that kids can play.
- **Problem:** receipts hold the truth about what a household buys, and
  nobody reads them.
- **What Arya does:** it reads each receipt, checks every line, nets out
  returns, and builds the list from purchase patterns plus a Spark judge.
- **Store maps:** every quest checks shelves (grabs, sightings, shortage
  reports), and one shopper's guided scan maps a store for the next.
- **Limit:** no store ships mapped yet. Maps depend on shoppers scanning.

## Technical depth (20%)

| Claim | Where to verify |
| --- | --- |
| One module calls the Meta API | `assistant/api/meta_client.py` |
| Receipts verified by arithmetic | `assistant/tests/test_receipt_math.py` |
| Demo writes never reach disk | `state.set_overlay` in `assistant/api/state.py`; sandbox tests |
| People are blurred before a frame is kept | `shelfscan.scrub_people` in `assistant/api/shelfscan.py` (fails closed) |
| Cost policy | `assistant/docs/MODEL-POLICY.md` |
| Measured results | `README.md`, "Measured results" |
| Tests | `cd assistant && python -m unittest discover -s tests` |

## Known limits

- No store ships pre-mapped; maps come from shoppers' scans.
- Open weights are used in one place: Muse Spark Open (on Baseten) is the
  second seat of the staple judge. It sees item names only, never
  personal data. Glimmer is not used.
- Closed in the demo: bulk imports, PDF and text decode, Curator runs
  and judge runs.
- Friends are single-account. Community prices, Deals and Arya shoppers
  are not live.
- Live calls can be slow (receipts take up to 90 seconds). A daily budget
  and a per-IP limit protect the account.

## If something fails

| Symptom | What to do |
| --- | --- |
| "demo rate limit" | Wait a minute and retry. |
| Receipt spinner over 90 s | Wait for the Spark fallback, or Skip. |
| Voice gives nothing | Check microphone permission, or type. |
| Page looks stale | Reload twice, or clear site data. |
