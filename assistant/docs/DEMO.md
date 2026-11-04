# Demo runbook — Arya

There are two paths. Path A is the live presentation on my account (real
data, 114 trips). Path B is the judge self-serve path (demo household).
The video follows the Path A beats. The narration is safe for Path B too.

## Beats (fixed order; follows the locked video script of 2026-11-04)

The narration itself is `docs/demo-video/SCRIPT.md` (the owner's words,
verbatim). The timings are from the finished cut, which runs under three minutes with the two cards.

1. **The chore** (0:00 to 0:32, animation and phone captures). Lists in
   notes, a partner adding items over text from a different store, yogurt
   bought twice, the toilet paper nobody bought, the empty milk shelf,
   receipts in the trash, the cheese that went bad. Close: "You hold all of
   it in your head, and it's still never quite right."
2. **What Arya is** (0:32 to 0:54). One place for groceries: shared lists,
   guided store routes, spend and usage insights, community powered alerts.
   The idea: shoppers share where items are, what's cheaper and what's out
   of stock, so every trip gets a little easier. (Shared prices are planned,
   not switched on, so do not demo them.)
3. **The engine and the proof** (0:54 to 1:20, my real account). "Using
   Muse Wonder, I created Arya's learning engine" (Muse Code running Wonder
   wrote the day-one engine; the receipts were imported as data and checked
   by code, no model read the 114 as photos). On screen: egg whites in 35 of
   114 trips, spinach up 18% since June (Price watch), the same bag of almond
   flour at $13.59 in one Costco and $16.99 in another.
4. **The list and Quest** (1:20 to 1:33). Arya drafts the next list from
   what the household uses (it suggests; it never adds on its own). Add by
   typing, speaking, or a photo of a handwritten list. Quest mode turns the
   trip into a game.
5. **Before the trip** (1:33 to 1:37). Today warns that eggs are out of
   stock at my store (three test accounts tapped Not here, the 3-shopper rule).
6. **In the store** (1:37 to 2:02). The quest guides me aisle by aisle. Find
   it for me: point the camera at a shelf, SAM finds the item, Spark checks
   the crop and the item lights up (see the [model map](../../JUDGES.md#which-model-does-which-job)).
   Empty shelf: tap "Not here?" (or Can't find it, then The shelf is
   empty), and the next shopper knows. At checkout,
   snap the receipt: Spark reads it first, and Muse Wonder takes a second
   look only when a check fails. "The learning engine improves with every
   trip."
7. **Back home** (2:02 to 2:12). Today shows Use soon: the milk. Ask Arya:
   "I just finished the yogurt." The reply marks it out and puts it on the
   list. Show the Ask reply only. Do not cut to a list that does not show
   yogurt.
8. **Where it stands** (2:12 to 2:49). "Arya is soft launched": the demo is
   open to everyone, accounts are invite-only for beta testers. Muse, the
   Meta AI agent, talks to Arya over MCP. The developer portal is live
   (`/developers`, API reference, MCP connector). "During the hackathon, I
   built the first step." Close: "Humans helping humans. This is Arya."
9. **Cards** (3 s each). Stack card: Built on Meta models (Muse Spark 1.3,
   Muse Wonder 1.0, SAM 3.1, Muse Voice Transcribe, Muse Image, Muse Spark
   Open, via the Meta Model API). End card: arya.teamnightshift.org, try the
   demo with no sign-up, join the waitlist, animations by Meta AI Vibes.

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

- Live decode is slow, because the network path adds seconds. Keep one
  receipt already decoded. Cut to it and keep talking.
- The demo household needs no network path to the model, so it always opens.
- A deploy ends every open demo (demo sessions live in server memory).
  The open app goes back to the start page and says "Arya was updated.
  Start the demo again." Do not deploy while judges use the demo.

## Say this, not that (folded in from the retired demo-features list, 2026-11-01)

- Pitch: "the grocery memory that gets smarter every trip."
- Say "Arya shoppers" for community data. Community prices are opt-in and
  not live. Do not show them as working.
- Say "open platform" for the API only after it is deployed.
- Show only what is on the VM. `/health` shows the running commit. Check it
  against `STATUS.md` before recording.
- The ask beat is stronger with a how-to question ("How do I add a
  receipt?") or a photo. Household sharing is the swap if a beat must go.
- My switches in `assistant/deploy/.env` that change what the demo can
  show: `ARYA_DEMO_TOWN`, `ARYA_KROGER_AISLES`, `ARYA_OWNER_USERNAME`,
  `ARYA_WAITLIST_ADMINS`, `ARYA_SUPABASE_AUTH`. Details are in `STATUS.md`
  (Feature flags) and `assistant/docs/OPS.md`.
- Ideas not built are tracked as GitHub issues (#155, #157 to #170). None
  of them belong in the video.
