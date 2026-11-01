# Demo runbook — Arya

Two paths. Path A is the live presentation on the owner's account (real
data, 114 trips). Path B is the judge self-serve path (demo household).
The video follows Path A beats; the narration is Path B safe.

## Beats (fixed order)

1. **Scan.** Upload a receipt PDF. Arya reads it and states the total.
   Say: "The receipt is a sensor. Every line is checked by arithmetic."
2. **Verified total.** The receipt shows "Total checks out."
   Say: "If the lines do not add to the total, nothing posts silently.
   The bad lines wait in the review queue."
3. **Learn.** Open the item. Show buys, the interval, the price by store.
   Say: "Patterns are math, not prompts. Three kept buys make a cadence."
4. **The list writes itself.** Open Today. Show Running low with date
   ranges and reasons, and your lists under it (Lists tab for each store).
5. **A return changes the ledger.** Open Spending. Show
   the returns total and the trip it came from. Say: "Returns are
   first class. A returned item is never suggested again."
6. **Ask Arya.** Type: "We finished the Greek yogurt." The action
   applies and the list updates. Ask: "What did we spend on coffee?"
   Say: "The agent answers from the model. It does not invent numbers."
7. **Start shopping.** Open a list and tap "Start shopping". A quest opens
   at that list's store. Say: "Arya guides the shop. Nothing buys itself."

## Judge path (no narration)

Open the site. Tap "Try it now." The household is fictional. Today
shows items due and the list. Spending shows the netted
return and the gift card under "Bought for others." The judge can add
items (type, photo, voice), start a quest from a list, finish on a
receipt photo, and ask Arya. Every demo write lives in a sandbox for
that visit only. Bulk imports, PDF decode and batch model jobs need a
real account. The step-by-step version is
`docs/quest/JUDGE-PLAYBOOK.md`.

## Failure fallbacks

- Live decode is slow: the network path adds seconds. Keep one receipt
  already decoded; cut to it and keep talking.
- The demo household needs no network path to the model: it always opens.
- A deploy ends every open demo (demo sessions live in server memory).
  The open app goes back to the start page and says "Arya was updated.
  Start the demo again." Do not deploy while judges use the demo.
