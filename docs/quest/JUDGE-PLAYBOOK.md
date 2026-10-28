# Judge playbook — Arya

A step-by-step path through the live demo. It takes about 8 minutes.
Each step has four parts: what to do, what you should see, what
happens under the hood, and which Meta product is in play. The steps
are grouped by the four judging criteria so you can score as you go.

**Live demo:** https://arya-pilot.duckdns.org/ — no account, no password.
Use a phone, or a browser window about 390 px wide. Allow the camera
and the microphone if you want steps 3, 4, 7 and 8 to use them.

## Before you start

**Deploy status.** The live site shows the version in the table below.
Steps marked **[needs #7]** work only when the landing page and the
demo sandbox are deployed (pull request #7, merged to `main`). The
owner deploys with `git pull` on the server. Until then the live site
runs an older build.

| What you see on the first page | Build | What it means |
|---|---|---|
| A photo of a store, a paragraph, and a button "Try the demo — play the Trader Joe's hunt" | New (service worker `arya-v33` or later) | Everything below works. |
| A bare "Sign in" form and a button "Try the demo household" | Old (`arya-v32`) | The demo household is **read-only**. Steps 1–4 and 9 work. Steps 5–8 fail at the first write with "the demo household is read-only". Use the demo video for those steps. |

Two small fixes are in pull request #12 (Ask no longer shows internal
ids such as `manual-milk`; an empty cart shows no Approve button). If
#12 is not deployed, ignore those two small defects.

**What you need.** A receipt photo for step 8. Any grocery receipt
works: a paper one, or a photo of one on a screen. The app has no
built-in sample receipt yet (it is drawn in `wireframes.html` for the
next release). If you have none, tap **Skip** in step 8; the hunt
still ends, and you only lose the receipt score.

**What is real, what is not.** The demo household is fictional. Your
changes live in an in-memory sandbox for your visit only. Nothing is
written to disk and no other visitor sees it. The Trader Joe's store
view is built from one shopper's walkthrough video (team holds the
rights). Camera, microphone and chat call the Meta API live.

---

## Part A — Demo (25%): the one-minute story

### 1. Open the site and read the front door
- **Do:** Open the link. Read the page. Tap **Try the demo — play the Trader Joe's hunt**. **[needs #7]**
- **See:** A photo of a Trader Joe's aisle, one paragraph, a list of Meta models, then the Today screen with a banner "Demo household — fictional data. Play anything: your changes last only for this visit."
- **Happens:** The button calls `POST /auth/demo`. The server sets a demo cookie and opens a private sandbox for you (an in-memory copy layered over the shipped household; at most 500 are kept).
- **Meta:** None on this step. The page names the Meta models used.

### 2. Read Today
- **Do:** Look at Today, then tap the **List** tab.
- **See:** Items "running low" with reasons, and a shopping list that Arya wrote.
- **Happens:** Patterns are plain math: after three kept purchases, Arya has a buying interval and a price by store. Returns are netted out, and a returned item is never suggested again. A Muse Spark "staple judge" decides which items may go on the list. The demo household's dates are shifted so the last trip is three days ago.
- **Meta:** **Muse Spark 1.3** (the staple judge; precision 0.79 against a purchase-cadence proxy on the owner's 114 receipts).

---

## Part B — Meta tooling (25%): each model, used for real

### 3. Dictate items (Muse Voice Transcribe)
- **Do:** Tap **Add**. Tap **Record**. Say "two gallons of milk, eggs, and blueberries". Tap again to stop.
- **See:** Your words appear as text in the box. Edit them if needed. Tap **Add**; the items join the List.
- **Happens:** The browser records audio and sends it to `/api/transcribe`. The server calls the Meta API and returns text. Nothing is filed until you tap Add.
- **Meta:** **Muse Voice Transcribe**.
- **If it fails:** Type the same words. Dictation needs microphone permission and a supported browser.

### 4. Photograph a handwritten list (Muse Spark vision)
- **Do:** On **Add**, tap **Photo**. Photograph a handwritten note or a whiteboard list.
- **See:** The items on the note are added to the list as structured rows.
- **Happens:** The photo goes to `/api/list/from-photo`. Muse Spark reads the handwriting and returns item names and quantities. Code, not the model, files them into the sandbox list.
- **Meta:** **Muse Spark 1.3 Standard** (Meta Model API).
- **If it fails:** Use a clear, well-lit photo, or type the items. The fridge-photo door ("Eyes") and bulk imports are closed in the demo; they need a real account.

### 5. Start a hunt (Quest) **[needs #7]**
- **Do:** Tap **Today**. Tap **+ New session**. Tap **Start from your Arya list** (or type items). Tap **Pick the store →**. Choose **Trader Joe's**. Tap **Looks right →**. Choose **Quest**.
- **See:** A hunt screen in the **Photos** view: real photos of the real aisle, a route strip, and an "Up next" rail. After a few seconds the first stop "arrives" and a **Grab** button lights up.
- **Happens:** The Optimizer matches your items to the store's product dictionary and orders them along the route. Each stop sits on a shelf that SAM 3.1 segmented and Spark labeled from the walkthrough video. In the demo the walk is simulated on a timer (judges are seated); in a store, position sets arrival.
- **Meta:** **SAM 3.1** (shelf and product segmentation, run once per store in the mapping pipeline) and **Muse Spark** (shelf labels). VGGT builds the 3D geometry; it is Meta AI research but is **not** on the event's model list, so we do not count it as a hackathon model.
- **If it fails:** If you see "the demo household is read-only", the build is old (see "Before you start"). If a step shows "demo rate limit — try again in a bit", wait a minute. If the optimizer merges two items you meant to keep apart (for example "pasta sauce" into "Pasta 1 lb"), tap **Undo**; this is a known defect.

### 6. Grab items and meet the characters (Muse Image)
- **Do:** Tap **Grab** at the first stop. Repeat for two more stops. Use the view chips to switch between **Photos**, **3D**, **Aisle** and **Strip**.
- **See:** Each grab shows an animated character with one fun fact. The "Up next" rail updates. The 3D view shows the store's point cloud.
- **Happens:** A grab calls the session API, marks the stop collected and updates the clock. The characters are 20 pictures drawn once and shipped as app assets, so there is no live image call and no cost.
- **Meta:** **Muse Image 1.0** (the celebration characters).
- **If it fails:** If the 3D view is slow on your phone, stay in Photos or Strip. The Quest screens have known layout defects (dense overlay, a toast over the rail, the Express list button). They wait for the Hunt v2 rebuild.

### 7. "Where am I?" and Scan shelf
- **Do (Where am I):** In Photos or 3D view, tap the compass button (**Where am I?**). Upload any photo of an aisle (the demo has no real store around you, so use a frame from the walkthrough, or any shelf photo).
- **See:** A toast "Placed you at <shelf>", or "Couldn't place that photo — keep following the route".
- **Happens:** A matcher compares your photo with indexed frames of the store. It runs on the server with no model call. **Muse Wonder wrote this matcher** in a spike session on Oct 27. It placed 42 of 45 held-out frames at the right stop (45 of 45 within one stop). Those frames come from the same mapping video; fresh shopper photos are **not yet measured**.
- **Do (Scan shelf):** Switch to the **Strip** view. Tap the camera button (**Scan shelf**). Photograph a shelf.
- **See:** Items from your list that appear in the photo are highlighted with a **Grab** card.
- **Happens:** SAM 3.1 proposes regions that may hold products. Muse Spark checks each crop against your list. A second model verifies before anything is highlighted.
- **Meta:** **SAM 3.1** + **Muse Spark** (Scan shelf); **Muse Wonder** as author of the matcher (Where am I?).
- **If it fails:** Nothing found is a valid result. Try a photo with packaged goods in frame. Both doors share a per-IP live-door limit.

### 8. Finish with a receipt (Muse Wonder) **[needs #7]**
- **Do:** Grab the remaining items or tap the check button to finish. On **Finish**, tap **Snap the receipt** and choose your receipt photo. Wait up to about 90 seconds.
- **See:** A **Score** screen: items found, time, the verified total, and badges.
- **Happens:** The photo goes to `/decode/photo`. **Muse Wonder 1.0** reads each line (product and price). Code then adds the lines and compares the sum with the printed total ("arithmetic verified"). A line that does not add up waits in a review queue; nothing posts silently. If Wonder takes longer than 90 seconds, Arya falls back to Muse Spark, and the receipt records which model read it. In the demo, the receipt files into your sandbox.
- **Meta:** **Muse Wonder 1.0** (receipt reader), **Muse Spark** (fallback). On the 9-receipt public test set (98 lines), Wonder got 97/98 lines right on product and price after hand adjudication (the automatic scorer gives 87/98), with zero price errors. Spark got 92/98 on the same adjudication. The README's "Measured results" is the one source for these numbers.
- **If it fails:** If the photo is blurry or cropped, retake it flat and in light. If you have no receipt, tap **Skip**; the hunt closes as "Receipt missing". A real receipt from a store other than Trader Joe's still scores, but item matching against the store may be partial.

### 9. Ask Arya
- **Do:** Tap **Ask**. Type "What am I running low on?" Then type "We finished the Greek yogurt."
- **See:** An answer that names items from the household. The second message applies a change and the list updates.
- **Happens:** Ask Arya is an agent grounded in a snapshot of the household model. It answers from the data. When you state a fact, it proposes an action; the server validates the action before it applies. It does not invent numbers.
- **Meta:** **Muse Spark 1.3 Standard** through the Meta Model API.
- **If it fails:** If the reply shows internal ids like `manual-milk`, the build lacks pull request #12. This is cosmetic. Ask is rate-limited per IP in the demo.

---

## Part C — Impact (30%): why this matters

Read this while the receipt step runs.

- **Who:** Every household that shops weekly. Families get a shared list that writes itself and a hunt that kids can play.
- **The problem:** The weekly shop is repetitive work that no one tracks well. Receipts hold the truth about what a household buys, but nobody reads them.
- **What Arya does:** The receipt is a sensor. Code checks every line. Returns are first class. The list is math plus a Spark judge, not a prompt guess.
- **The flywheel:** Each shopper who walks a store can map it for the next one. "Mapped by" credit goes to the contributor. Today one store (Trader Joe's, Chino Hills) is mapped; an unmapped store plays on the flat Strip view.
- **Honest limit:** The hunt is mapped for one store. Impact beyond that depends on contributors.

## Part D — Technical depth (20%): what to check

| Claim | Where to verify |
|---|---|
| All Meta API calls go through one module | `assistant/api/meta_client.py` (rule in `AGENTS.md`) |
| Receipts are verified by arithmetic, not trust | `assistant/tests/test_receipt_math.py`; the "arithmetic verified" tag |
| Demo writes never reach disk or another visitor | `state.set_overlay`; tests in `assistant/tests/` (sandbox contract) |
| Cost policy: cheapest model that holds the golden-set score; Wonder banned from volume paths | `assistant/docs/MODEL-POLICY.md` |
| Personal data stays in Standard mode | `meta_client.py` |
| Measured results (one source) | README, "Measured results" |
| Test suite | `cd assistant && python -m unittest discover -s tests` (321 on `main`; 325 with #12) |
| How it was built | README, "How this was built": build window opened Oct 27; the engine came from a Muse Wonder spike session on Oct 27, then was committed in stages |

---

## Known limits (said plainly)

- **One mapped store.** Trader Joe's (Chino Hills). Costco plays on the Aisle and Strip views.
- **Localizer evidence is thin.** 42/45 is on held-out frames from the same video, not on fresh photos.
- **Staple judge precision is 0.79,** measured against a proxy, not against ground truth.
- **Open weights are not used yet.** No Muse Spark Open or Glimmer job has run. We do not claim the open-weights bonus.
- **VGGT is not on the event's model list.** It builds the 3D geometry; we do not count it as a hackathon model.
- **Demo closed doors:** bulk imports, PDF and text decode, fridge photos, Curator and judge runs, the Resolver. They need a real account.
- **Single-account social.** Shop-Off and Friends do not work across accounts yet. The opponent is a placeholder.
- **Today's date** in the owner's real account is anchored to the last receipt. The demo household is shifted to the present.
- **Hunt v2 UI defects** (dense overlay, toast over the rail, covered Express list button) are known and frozen until the rebuild.
- **Live Meta calls can be slow.** Receipt reads can take up to 90 seconds. A daily budget and a per-IP limit protect the account; if either trips, you see "demo rate limit" or "daily model budget reached".

## If something fails

| Symptom | Cause | What to do |
|---|---|---|
| "the demo household is read-only" | Old build (no #7) | Use the video for steps 5–8. |
| "demo rate limit — try again in a bit" | Per-IP cap on live doors | Wait a minute, then retry. |
| Receipt spinner for more than 90 s | Wonder timeout, then Spark fallback | Wait for the fallback, or tap Skip. |
| Voice gives nothing | Mic permission or browser | Type the items instead. |
| 3D view is slow | Phone GPU | Use Photos or Strip. |
| Page looks stale | Service worker cache | Reload twice, or clear site data. |
| Site does not load | DNS or server | Try again; the demo video shows the same path. |

## Score sheet

| Criterion | Weight | Where to see it |
|---|---|---|
| Impact | 30% | Part C; steps 2, 5, 8 |
| Use of Meta tooling | 25% | Steps 2–9: Voice Transcribe, Spark, SAM 3.1, Muse Image, Wonder |
| Demo | 25% | Steps 1–9 as one flow, about 8 minutes |
| Technical depth | 20% | Part D; step 8 (arithmetic check, fallback); step 7 (Wonder-authored matcher) |
