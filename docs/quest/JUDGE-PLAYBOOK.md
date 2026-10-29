# Judge playbook — Arya

A path through the live demo in about 8 minutes, grouped by the
judging criteria. Each step says what to do, what you see, and which
Meta model is in play.

**Live demo:** https://arya-pilot.duckdns.org/ — no account. Use a
phone, or a browser window about 390 px wide. Allow the camera and the
microphone for steps 3, 4, 6 and 7.

**What is real.** The demo household is fictional. Your changes live
in an in-memory sandbox for your visit only; nothing reaches disk or
another visitor. The Trader Joe's view is built from one shopper's
walkthrough video, with shoppers blurred by SAM. Camera, microphone and
chat call the Meta API live.

**What you need.** A receipt photo for step 7 (any grocery receipt).
Without one, use **Use a sample receipt** or **Skip**.

---

## Demo (25%)

### 1. Front door
Tap **Try the demo — play the Trader Joe's hunt**. You land on Today
with the banner "Demo household — fictional data." The server opens a
private sandbox for your visit.

### 2. Today and List
Today shows items running low with reasons and your level. The List
tab shows the list Arya wrote: plain math after three kept purchases,
returns netted out, and a **Muse Spark 1.3** staple judge deciding what
may go on the list (precision 0.79 against a cadence proxy).

---

## Meta tooling (25%)

### 3. Dictate items — Muse Voice Transcribe
**Add** → **Record** → say "two gallons of milk, eggs, and
blueberries" → stop. The text lands in the box; tap **Add**.

### 4. Photograph a handwritten list — Muse Spark vision
**Add** → **Photo** of a note or whiteboard. Spark reads it; code files
the rows into the list.

### 5. Plan a hunt
**Today** → **New hunt**. Pick **Trader Joe's**: each store says what
you usually buy there, counted from receipts. The next screen sorts
your list for that store: milk and sourdough ticked ("usually here"),
usuals such as spinach suggested. Pick **Costco** instead and milk
moves to "Usually from Trader Joe's" while eggs and paper towels are
suggested. Tap **Start the quest** → **Quest**. A clean list skips
Check my list.

### 6. Play — SAM 3.1, Muse Spark, Muse Image
- **How to play** shows once: find it, grab it, snap the receipt.
- The view is real photos of the store; the orange dot is your next
  item. **See it in 3D** shows the point cloud.
- Tap **Grab**: +10, a Muse Image character, a fun fact. Points only
  go up; there is no clock and no way to lose.
- **Find it for me** opens the camera aimed at the next item. SAM 3.1
  boxes candidates and Muse Spark checks each crop; the item lights up
  and one tap grabs it. Point it at any shelf photo on a second
  screen if you are not in a store.
- **Where am I?** places a photo at the nearest stop. Muse Wonder wrote
  this matcher (42/45 held-out frames at the right stop).
- **Not here?** files a shortage report for the next shopper.

### 7. Finish with a receipt — Muse Wonder
**Finish** → **Snap the receipt**. Muse Wonder 1.0 reads each line;
code checks that the lines add up to the printed total. Over 90 s,
Arya falls back to Muse Spark and records which model read it. The
Score counts the haul up (+80 items, +25 full haul, +50 receipt) and
fills the level bar. Wonder scored 97/98 lines on the public set after
adjudication, zero price errors.

### 8. Ask Arya — Muse Spark
**Ask** → "What am I running low on?", then "We finished the Greek
yogurt." The answer comes from the household data; the stated fact
becomes an action the server validates before it applies.

---

## Impact (30%)

- **Who:** every household that shops weekly; families get a list that
  writes itself and a hunt kids can play.
- **Problem:** receipts hold the truth about what a household buys,
  and nobody reads them.
- **What Arya does:** the receipt is a sensor; code checks every line;
  returns are first class; the list is math plus a Spark judge.
- **Flywheel:** every hunt is a shelf survey (grabs, sightings,
  shortage reports), and one shopper's walk maps a store for the next.
- **Limit:** one mapped store today; other stores play as shelf cards.

## Technical depth (20%)

| Claim | Where to verify |
| --- | --- |
| One module calls the Meta API | `assistant/api/meta_client.py` |
| Receipts verified by arithmetic | `assistant/tests/test_receipt_math.py` |
| Demo writes never reach disk | `state.set_overlay`; sandbox tests |
| No pictures of people kept | `shelfscan.scrub_people` (SAM, fails closed) |
| Cost policy | `assistant/docs/MODEL-POLICY.md` |
| Measured results | README, "Measured results" |
| Tests | `cd assistant && python -m unittest discover -s tests` |

## Known limits

- One mapped store (Trader Joe's, Chino Hills).
- Localizer evidence is held-out frames from the same video, not
  fresh shopper photos.
- Open weights are not used; we do not claim that bonus. VGGT builds
  the 3D geometry but is not on the event's model list.
- Closed in the demo: bulk imports, PDF and text decode,
  Curator and judge runs.
- Shop-Off and Friends are single-account.
- Live calls can be slow (receipts up to 90 s). A daily budget and a
  per-IP limit protect the account.

## If something fails

| Symptom | What to do |
| --- | --- |
| "demo rate limit" | Wait a minute and retry. |
| Receipt spinner over 90 s | Wait for the Spark fallback, or Skip. |
| Voice gives nothing | Check mic permission, or type. |
| 3D view is slow | Stay on the photos. |
| Page looks stale | Reload twice, or clear site data. |
