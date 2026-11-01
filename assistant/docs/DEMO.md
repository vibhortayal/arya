# Demo runbook — Arya

Two paths. Path A is the live presentation on the owner's account (real
data, 114 trips). Path B is the judge self-serve path (demo household).
The video follows Path A beats; the narration is Path B safe.

## Beats (fixed order; matches video script v4, `/mnt/project-files/demo-video/`)

1. **Why and bridge** (presenter, about 1:04). Groceries, scattered notes, no
   shared memory. Say: "I built Arya during this hackathon. I downloaded 114
   receipts from the Costco app, three years of my own shopping."
2. **Proof** (owner's real account: Spending, Receipts, Item). Arya checked all
   114 lines against the printed totals, in plain code. Show egg whites in 35 of
   114 trips, and almond flour at $13.59 in one Costco and $16.99 in another.
   Say: "Patterns are math, not prompts." No model read those 114 as photos;
   Spark only expands the receipt abbreviations.
3. **One trip.** The list is already made from what you buy. Add by typing, by
   voice or by a photo of a paper list. Start shopping: the quest walks you item
   to item; tap Got it. At a stop, Find it for me (SAM 3.1 finds the shelf,
   Spark checks it). Empty shelf: Not here? warns the next shopper. At checkout,
   snap the receipt: Spark reads it first, Arya checks the math, and Wonder
   re-reads only if the checks flag it.
4. **At home.** Today shows Use soon (the spinach). Ask Arya: "We finished the
   yogurt." The list updates. Say: "The agent answers from the model. It does not
   invent numbers."
5. **Limits and close.** Honest limits: it depends on its community. The
   developer portal is live (`/developers`, API reference, MCP connector). Do
   not say "I have started building".

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

## Say this, not that (folded in from the retired demo-features list, 2026-11-01)

- Pitch: "the grocery memory that gets smarter every trip."
- Say "Arya shoppers" for community data. Community prices are opt-in and
  not live; do not show them as working.
- Say "open platform" for the API only after it is deployed.
- Show only what is on the VM. `/health` shows the running commit; check it
  against `STATUS.md` before recording.
- The ask beat is stronger with a how-to question ("How do I add a
  receipt?") or a photo; household sharing is the swap if a beat must go.
- Owner switches in `assistant/deploy/.env` that change what the demo can
  show: `ARYA_DEMO_TOWN`, `ARYA_KROGER_AISLES`, `ARYA_OWNER_USERNAME`,
  `ARYA_WAITLIST_ADMINS`, `ARYA_SUPABASE_AUTH`. Details are in `STATUS.md`
  (Feature flags) and `assistant/docs/OPS.md`.
- Ideas not built are tracked as GitHub issues (#155, #157 to #170); none
  belong in the video.
