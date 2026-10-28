# Demo runbook — Arya

Two paths. Path A is the live presentation on the owner's account (real
data, 114 trips). Path B is the judge self-serve path (demo household).
The video follows Path A beats; the narration is Path B safe.

## Beats (fixed order)

1. **Scan.** Upload a receipt PDF. Arya reads it and states the total.
   Say: "The receipt is a sensor. Every line is checked by arithmetic."
2. **Verified total.** The receipt shows "arithmetic verified."
   Say: "If the lines do not add to the total, nothing posts silently.
   The bad lines wait in the review queue."
3. **Learn.** Open the item. Show buys, the interval, the price by store.
   Say: "Patterns are math, not prompts. Three kept buys make a cadence."
4. **The list writes itself.** Open Today. Show Running low with date
   ranges and reasons, and the list under it.
5. **Eyes.** Upload the fridge photo. Confirm the spinach sighting.
   Spinach leaves the list. Say: "A photo is evidence. Arya saw it, so
   Arya does not buy it. Nothing changes without your tap."
6. **A return changes the ledger.** Open Analysis (from Profile). Show
   the returns total and the trip it came from. Say: "Returns are
   first class. A returned item is never suggested again."
7. **Ask Arya.** Type: "We finished the Greek yogurt." The action
   applies and the list updates. Ask: "What did we spend on coffee?"
   Say: "The agent answers from the model. It does not invent numbers."
8. **Prepared cart.** Show the cart in state "waiting." Tap Approve.
   Say: "Arya prepares. A person approves. Nothing buys itself."

## Judge path (no narration)

Open the site. Tap "Try the demo household." The household is fictional
and read-only. Today shows items due and the list. Analysis (from
Profile) shows the netted return and the gift card under "Bought for
others." The demo's Photo and Voice doors are live — they call the
Meta API and persist nothing. Chat is off in the demo; it needs the
owner's account.

## Failure fallbacks

- Live decode is slow: the network path adds seconds. Keep one receipt
  already decoded; cut to it and keep talking.
- The tunnel name is the backup door if DNS fails.
- The demo household needs no network path to the model: it always opens.
