# The Assistant — Product Specification

Team Nightshift. Indie track. Meta Global AI Developer Hackathon.
Submission deadline: November 4, 2026, 9:00 PM ET.
The owner reviews the final package. No person submits without the approval of the owner.
This document uses ASD-STE100 style. Sentences are short. Each sentence has one idea.

Name: **Arya**; the hackathon entry is **Arya Quest**. Body text says
"the assistant". Structure as built: ARCHITECTURE.md. Decisions:
`docs/quest/DISCUSSION.md`.

## 1. What the product is

The assistant keeps a living model of the purchases of one household.
The model is inventory-first. Items and item states are the core objects.
The list, the dashboard, the patterns, and the reminders are views of the model.
The assistant blends the physical world and software.
Sensors read the physical world. The list, the reminders, and the prepared cart act on the physical world.
The assistant works in any store. The assistant needs no data from a retailer.
The assistant learns from evidence. The assistant does not guess.

## 2. Vision and scope

### 2.1 The long vision

The subject is the consumer behavior of the user.
The assistant sees what the household buys, keeps, uses, returns, and wastes.
Groceries are the first domain. Groceries are not the final domain.
Section 11 gives the expansion path.

### 2.2 The whole receipt counts

The model takes the whole receipt.
Food, household consumables, clothing, electronics, and gift cards all count as purchases.
Each category is visible in the ledger and in spend.
Deep pattern functions in the MVP apply to food and household consumables.
Electronics and clothing are captured and spend-visible only in the MVP.
Food gets the deep functions because food expires and food is visible in the home.

### 2.3 The MVP

The MVP has one user and one household.
The MVP uses the real data of the owner.
The MVP closes the core loop of Section 3 with no store map.
Quest (Section 6.8) is the play layer. It feeds the core and is not on its critical path.

## 3. The core loop

The core loop has eight steps. The loop repeats with each trip.

1. Intake. The user scans a receipt. The user scans the cart.
2. Decode. The system decodes each line. The system gives each line a confidence value.
3. Review. Lines with low confidence go to a review queue. The user confirms or corrects each line with one tap.
4. Ledger. Confirmed lines enter the ledger. Returns subtract from purchases. Discounts fold into the parent item.
5. Patterns. The system computes cadence and quantity for each repeat item.
6. Reconciliation. The system compares the list, the receipt, and the cart photo. The system asks about differences only.
7. The list. The system writes the next list from the patterns. The user edits the list with taps.
8. The prepared cart. The list becomes a prepared cart in a sandbox. The user approves the cart with one tap. Nothing buys itself.

The receipt is the sensor. The list is the surface.
A return changes the ledger. A return changes the patterns. A return changes the next list.

Three distinctions stay separate in the model:

- Bought is not kept. A return removes a purchase from consumption. Section 6.3 gives the return rules.
- Kept is not ours. A purchase for another person stays in spend. The purchase stays out of patterns, inventory, and the list. Section 6.2 gives the allocation rules.
- Bought for us is the only input to patterns, run-out estimates, and the list.

## 4. Rules for all components

Rule 1. Each claim has a confidence value and a repair path.
Rule 2. A confident claim is asserted. An unsure claim is asked. A contradicted claim is demoted and asked.
Rule 3. No line, item, or state is silently guessed.
Rule 4. A state with no evidence is "unknown." The system shows "unknown." The system asks for evidence.
Rule 5. Real personal data goes to Standard mode models only. Section 7.3 gives the reason.
Rule 6. Arithmetic is computed by code. A model narrates. A model does not do arithmetic.
Rule 7. Corrections from the user are final. A correction takes effect at once.
Rule 8. A discount line is structure, not identity. The system attaches it to its parent item. The system never asks the user about it.
Rule 9. Research proposes. The user disposes. An outside identification enters as a candidate with its source. It takes effect only on the word of the user.
Rule 10. A reasoning agent proposes changes to identity. It never applies them. No silent edits.

## 5. Users and user stories

The primary user is the owner. The data is the data of the owner.

| # | Story |
|---|---|
| US-1 | I upload receipts and get a decoded ledger. The system asks me only about lines with low confidence. |
| US-2 | I see what I buy, how often I buy it, and how much I buy. The view works for one item or for one category. |
| US-3 | The assistant drafts my next list from my patterns. I adjust the list with taps. I do not type. |
| US-4 | I photograph the receipt and the cart at checkout. The assistant verifies the trip and asks me only about differences. |
| US-5 | I photograph my refrigerator. The assistant corrects the inventory for the items in the photo. Items with no photo stay unknown. |
| US-6 | The assistant warns me before an item expires or runs low. The warning shows a date range and the reason. |
| US-7 | I return an item. The assistant removes the item from my patterns and from future lists. |
| US-8 | My list becomes a prepared cart. I approve the cart with one tap. |
| US-9 | I ask what I have. The assistant answers from the model and shows the evidence. |
| US-10 | Add-on only: at a store with a map, the assistant guides me to each item and finds the item on the shelf. |

## 6. Functional requirements

### 6.1 Receipt intake and decode (C1)

- FR-1.1 The system accepts a receipt as a PDF file, a photo, or a screenshot. The system records the source type at intake.
- FR-1.2 The system decodes each receipt into a DecodedReceipt. The contract is in IMPLEMENTATION.md Section 3.
- FR-1.3 The system decodes cryptic lines against the item dictionary first. The system uses model knowledge second.
- FR-1.4 Each line gets a confidence value. A line with confidence below 0.85 goes to the review queue. No line below the threshold enters the ledger without a confirmation from the user.
- FR-1.5 Arithmetic check: the sum of the line totals equals the receipt subtotal within 0.05 dollars. A receipt that fails the check is marked not verified. The system does not present a failed receipt as fact.
- FR-1.6 A correction from the user updates the dictionary at once. The same code does not ask twice.
- FR-1.7 Duplicate check: same merchant, same date, same total gives a warning. The system does not post a receipt two times.
- FR-1.8 A discount line folds into the parent item as a discount value. A discount line is not an item.
- FR-1.9 Each decoded line has an allocation field. The default value is HOUSEHOLD. Section 6.2 gives the allocation rules.

### 6.2 Item dictionary and ledger (C2)

- FR-2.1 The dictionary maps each name of a product to one canonical item. Names include the receipt code, the abbreviation, the brand name, and the name of the user.
- FR-2.2 The dictionary is the shared vocabulary. Decode, patterns, voice, and the store index read the same dictionary.
- FR-2.3 The ledger is append-only. A correction adds a new entry. A correction does not edit an old entry in silence.
- FR-2.4 Each ledger entry has a source receipt, a date, a price, a quantity, and a store.
- FR-2.5 The ledger computes spend by category and by period from ledger data alone.
- FR-2.6 The ledger is source-agnostic. A new source is an adapter. The engine does not change for a new source.

Allocation (a field on each ledger line):

- FR-2.7 The allocation has two values: HOUSEHOLD and FOR-OTHERS. A FOR-OTHERS line can carry the name of a person. The name is optional.
- FR-2.8 A FOR-OTHERS line stays in the ledger. A FOR-OTHERS line stays in spend truth. The money left the account.
- FR-2.9 The dashboard shows a FOR-OTHERS subtotal in a separate view. The label is "bought for others."
- FR-2.10 A FOR-OTHERS line never enters consumption patterns. A FOR-OTHERS line never enters cadence, run-out estimates, home inventory, or the list.
- FR-2.11 Reason: a purchase for a friend is not consumption of this household. Example: baby formula for a friend starts no baby-formula pattern in a household with no baby.
- FR-2.12 The user sets the allocation in the review queue with one tap. The button label is "Not for us."
- FR-2.13 The user can change the allocation later from the item view.
- FR-2.14 The assistant can ask about a line that looks like an errand purchase. Signals: the purchase is an unusual one-time bulk buy, the category is off-pattern for the household.
- FR-2.15 The assistant never excludes a line without an answer from the user. The ask-when-unsure rule applies.
- FR-2.16 Reimbursement tracking is roadmap. Reimbursement tracking is not in the MVP. Section 11 names the expansion.

### 6.3 Returns (C3)

- FR-3.1 Intake detects a return line and a return receipt. A return has a negative price or a refund marker.
- FR-3.2 The system matches a return to the original purchase by item number and by item identity.
- FR-3.3 A return subtracts from purchases before patterns compute. Patterns count kept items only.
- FR-3.4 A returned item leaves the suggestion pool. The item returns to the pool only if the user adds the item again.
- FR-3.5 The ledger shows a return as an event with its own type. The refund value reconciles into spend.
- FR-3.6 The return is visible in the history of the item.

### 6.4 Patterns and the consumption model (C4)

- FR-4.1 The system computes patterns with code from the ledger. Patterns include purchase count, dates, quantities, median interval, last purchase date, and spend for each canonical item.
- FR-4.2 A pattern needs two or more purchases. An item with one purchase shows "not enough history yet." The system invents no cadence for an item with one purchase.
- FR-4.3 Warehouse cadence is weeks, not days. Copy in the product uses the true scale of the data.
- FR-4.4 A run-out estimate is a date range. The estimate shows the reason: last purchase date and typical interval.
- FR-4.5 Patterns apply to food and household consumables in the MVP. Electronics and clothing show purchases and spend only.
- FR-4.6 Patterns exclude FOR-OTHERS lines. Section 6.2 gives the allocation rules. Patterns also exclude returned items. Section 6.3 gives the return rules.

### 6.5 The self-writing list and the prepared cart (C5)

- FR-5.1 The system drafts the list from the patterns. An item is due when the time since the last purchase is equal to or more than the median interval of the item.
- FR-5.2 The suggested quantity comes from the typical quantity of the item.
- FR-5.3 The model ranks and narrates the draft. The model adds no item outside the computed due set and the additions of the user.
- FR-5.5 The list becomes a prepared cart in a sandbox. The cart lists items, quantities, and the store of the user.
- FR-5.6 The cart waits for approval. The user approves with one tap. The system sends no order and makes no payment. The sandbox is the full scope of the cart in the MVP.

### 6.6 Reconciliation (C6)

- FR-6.1 Reconciliation joins three evidence sources: the list, the receipt, and the cart photo.
- FR-6.2 Price and quantity are the join keys. The cart photo identifies the product of a cryptic receipt line.
- FR-6.3 A confident match posts with no action from the user.
- FR-6.4 An ambiguous or unseen item goes to the unverified list. The user confirms or corrects with one tap.
- FR-6.5 Each correction updates the dictionary.
- FR-6.6 Photo protocol: the receipt lies flat. The cart photo is top-down. A short pan is optional for stacked items.

### 6.7 Expiry (C7)

- FR-7.6 Expiry uses category shelf-life priors first. One prior per category: greens days, milk about a week, eggs weeks.
- FR-7.7 For a high-risk item in a new trip, the system asks the user for one photo of the printed date before put-away. The system asks for high-risk items only.
- FR-7.8 A report of "this expired" from the user adjusts the shelf-life model of that item for this household.
- FR-7.9 An expiry warning is a question, not a fact. Example: "The spinach from October 24 usually turns about now. Is it still good?"

### 6.8 Quest — the play layer (C8)

Quest turns a store trip into a game. It feeds the core; it never
replaces it. Detail: `docs/quest/GAME-DESIGN.md` and the wireframes.

- FR-8.1 A hunt is one store trip: one store, one list, one mode
  (Quest or Express). A receipt settles it.
- FR-8.2 Planning starts from the store. The list is sorted by where
  each item is usually bought, counted from the ledger. Unticked items
  stay on the list. Removing an item removes it from the list.
- FR-8.3 The game has no lives, no game over and no clock. Points
  only go up: +10 a grab, +25 a full haul, +50 the receipt. Points
  bank when the receipt lands.
- FR-8.4 Any stop can be grabbed in any order. A grab can be put back.
  Nothing finishes by itself.
- FR-8.5 A store with a walkthrough plays over its photos; any other
  store plays as shelf cards. The system invents no location.
- FR-8.6 Shelf Scan and Find it for me: SAM 3.1 proposes boxes, Spark
  verifies each crop. Only a verified item highlights. A miss never
  says the item is absent.
- FR-8.7 No pictures of people are kept. A frame is kept only after
  SAM finds every person and the frame is pixelated there. If the
  scrub fails, the frame is not kept.
- FR-8.8 "Not here?" files a report and edits nothing. Time resolves
  it: a later grab means a stockout; a confirmed new spot means a move.
- FR-8.9 Every board and badge is receipt-verified.

### 6.9 Meal hook — optional scene (C9)

- FR-9.1 The system can suggest one dinner from ingredients the ledger supports. The suggestion shows the reason.
- FR-9.2 A missing ingredient joins the list with one tap.
- FR-9.3 The scene is optional. The scene is the first cut under time pressure.
- FR-9.4 The product makes no nutrition claims. Money and habits only.

## 7. Non-functional requirements

### 7.1 Latency budgets (Standard mode)

| Interaction | Budget | Note |
|---|---|---|
| Receipt decode, PDF to draft | 20 s or less | Progress is visible |
| Receipt decode, photo to draft | 30 s or less (Wonder, under the amendment: 90 s bound, then Spark) | Progress is visible |
| Review queue, one trip | 30 s or less of user time | One tap per line |
| List draft generation | 5 s or less | The due set is computed by code |
| Quest: Shelf Scan / Find it for me, one frame | 4–8 s | Not blocking; the camera stays live |
| Quest: Where am I?, one photo | about 1 s | Local matcher, no model call |

Spark is a reasoning model. Default effort is slow.
In-store calls use low reasoning effort, short prompts, and cached prefixes.
Cached input costs 0.15 dollars per million tokens. Standard input costs 1.25 dollars per million tokens.

### 7.2 Cost budget

The ceiling is the 150 dollar Meta Model API credit.
Each API call is logged with model, mode, tokens, and cost.
No call is unmetered.
Target cost per trip is 0.35 dollars or less on Standard rates.
Spike 1 cost: 0.20 dollars for seven receipts.
IMPLEMENTATION.md Section 8 gives the stage allocations.

### 7.3 Privacy

The map, the ledger, and the dictionary belong to one user.
Records stay on the server of the user.
Real receipts and home photos go to Standard mode models only.
A Contributor mode model can be trained on inputs. Meta terms bar personal data on Contributor mode.
Contributor mode is for synthetic data in development loops only.
The demo states one fact in plain words: photos and receipts go to the Meta API for processing, in Standard mode, with no training on the data.
The demo household is synthetic (the "Sharma family"). Its data is invented. The data of the owner lives on his own account only. No data of a third party is in the demo.

### 7.4 Connectivity and degradation

In-store connectivity is poor.
The PWA caches the app shell, the active list, and the active store index after trip start.
The PWA queues corrections and check-offs on the device. A correction applies on the device at once. Sync runs at reconnect.
Degradation order: live model calls, then cached data with manual check-off.
Manual check-off always works.

## 8. Client requirements (PWA-core)

The PWA is installable. The PWA is phone-first. The PWA uses one hand.
PWA-core has five tabs: Today, List, Add, Ask, Profile. Receipts and
Analysis are reached from Profile. Item and category detail opens from
any list.

1. Today. Running low is first. Each item shows a date range. The list draft sits below. One tap confirms, edits, or adds.
2. List and Add. The Add tab is one surface: a text field, a mic, a camera, and the pointer to Muse in chat. Receipts enter by image only. The review queue sits with the receipts.
3. Analysis (from Profile). Spend by category over time. Trip history. Top items. The returns total. The bought-for-others subtotal of Section 6.2.
4. Item and category detail. Purchase timeline. Cadence. Pack sizes. Price trend by store. Run-out range. Purchase and return history. Controls: add to list now, snooze suggestion, never suggest, change allocation.

Honesty rules for all screens:

- A pattern needs two or more purchases. A single purchase shows "not enough history yet."
- A run-out date is a range. The reason is visible.
- An unverified item looks unverified until confirmation.
- A returned item is visible in the ledger and in the item history.
- An unseen item is unknown. The screen shows unknown.

The UX build follows the impeccable skill playbook.
The design bar is: a joy, easy, intuitive.
Targets in the store are 64 pixels or more. No text input is required in the store.

## 9. Gates and acceptance criteria

### Gate 0 — photo-receipt gate (before the build commits)

Set as planned: 20 real paper receipts, stores and light mixed.
As run: the planned composition was abandoned. The gate ran on 9 public receipts (98 lines) plus the owner subset (32 lines), reported separately, as below.
Data isolation is a hard rule. Public receipts are test fixtures only.
A public receipt never enters the ledger of the owner.
A public receipt never enters the dictionary of the owner.
A public receipt never enters the patterns of the owner.
Gate data lives in a separate store. The gate store is discarded or archived after scoring.
The two subsets report separately. The pass mark applies to the combined set and to the owner subset.
Pass mark: 90 percent or more of lines correct.
A correct line has the right product, the right quantity, and the right price.
The build commits only after this gate passes.
Fallback after a failure: PDF receipts and e-receipts only. Photo intake leaves the MVP.

Status of the evidence:

- Spike 1 (PDF decode) passed on October 27, 2026. Seven real Costco receipts. Seven of seven arithmetic matches. Zero silently-wrong lines in manual review. Both return receipts detected. Cost: 0.20 dollars total.
- Gate 0 PASSED (2026-10-27). Public set: 90 of 98 lines correct (91.84 percent). Owner subset: 32 of 32. Combined: 122 of 130 (93.85 percent). Arithmetic reconciled on 7 of 7 receipts. One silent price rotation in the public set got through; it is disclosed, and the review queue is the mitigation. Full record: the research repo's GATE-REPORT.md.

### Gate 1 — decode quality (Stage 1, golden receipt set, Standard mode)

- 95 percent or more of lines captured. No line drops in silence.
- 85 percent or more of lines auto-posted and correct.
- Silently-wrong auto-posts: 2 percent or less of lines.
- Totals reconcile within 0.05 dollars on the golden set.
- After one corrections pass, a re-decode asks about zero corrected codes.

### Gate 2 — core loop (Stage 2 and Stage 3)

| Component | Criterion |
|---|---|
| Returns (C3) | A return in the test set nets against the purchase. The item leaves the patterns and the list draft. |
| Allocation (Section 6.2) | A line marked FOR-OTHERS is in spend. The line is in no pattern, no run-out estimate, and no list draft. |
| Patterns (C4) | Counts and intervals match a hand-computed check on the golden ledger for 100 percent of items. |
| Smart list (C5) | The due set equals the rule output of FR-5.1. The narration adds no item outside the due set. |
| Prepared cart (C5) | The cart matches the approved list. The cart sends no order. |
| Reconciliation (C6) | A test trip with one mismatch asks about that mismatch only. |

### Gate 3 — superseded

The store add-on became Quest (Discussion 29). Quest is measured by
its own evidence: the localizer (42/45 held-out frames) and Shelf Scan
(0 false pops in the spike).

## 10. Positioning and demo requirements

Source: COMPETITORS.md. Sixteen products scored on six functions.

### 10.1 What the teardown shows

Receipt ingestion is a commodity. Fetch, CoinOut, and Receipt Hog take any receipt.
Fridge photos exist. Samsung Food identifies ingredients from a photo.
Cross-retailer history exists inside one wall. Instacart history covers Instacart orders only.
No product merges a paper receipt from one store and an order from another store into one model.
List help is common. List writing from learned cadence is not common.

### 10.2 The edge is a combination

The edge is not one feature. The edge is the joint claim:

1. A verified cross-store ledger. Totals pass an arithmetic check. Each line has a confidence value.
2. Returns netting. No competitor in the set subtracts a return from a ledger, a pattern, or a list. The returns column is empty for all sixteen products.
3. Learned cross-store cadence. No competitor learns cadence from receipts across stores. The all-category part of this claim is roadmap. The MVP claim is food and household consumables.

The closest threat is FridgeBuddy. FridgeBuddy has receipt import from photo or PDF, a check step before saving, and shelf-photo inventory.
FridgeBuddy has no cross-store history, no cadence, no returns, and no self-writing list.
Platform risk is real. Samsung or Instacart can close the gap in one release.

### 10.3 Demo requirements

The demo shows: a receipt scan; the model learning; the list writing
itself; a planned hunt with a grab and Find it for me; a return
changing the ledger; a total verified by arithmetic; the privacy
sentence of Section 7.3. The judge path: `docs/quest/JUDGE-PLAYBOOK.md`.

## 11. Future vision

Expansion one is Wide.
A mapper network supplies shared walkthroughs. Walkthroughs have quality grades.
The assistant builds maps for many stores.

Expansion two is Deep.
The assistant learns expiry behavior for one household.
The assistant reports waste. The assistant connects delivery spend to recipes for home cooking.

Expansion three is All Purchases.
The subject is the consumer behavior of the user.
Amazon orders enter the model. Dining receipts enter the model. Online and offline receipts enter the model.
Sources are adapters. The engine does not change.
Reimbursement and settled tracking for bought-for-others purchases belongs to this expansion.
It is not in the MVP.

Groceries are the first domain. Groceries are not the final domain.

## 12. Out of scope for the MVP

- Nutrition, health, or dietary advice. This exclusion is permanent.
- Multiple users and shared lists.
- A real order or a real payment. The cart is a sandbox.
- Reimbursement tracking for bought-for-others purchases.
- Retailer planogram data and retailer integrations.
- Live guidance on glasses. Glasses record video only.
- Always-listening voice. Turn-by-turn indoor positioning.
- Muse Wonder is in the pipeline as built: it reads receipt photos (Spark is the fallback) and it authored the hunt localizer. Its photo-decode role runs under the MODEL-POLICY hackathon amendment, which expires Nov 4, 2026; decode returns to Spark then unless the owner extends it.
- The mapper network and consensus maps. Section 11 covers these items as vision.

Design flags live in IMPLEMENTATION.md Section 8.
