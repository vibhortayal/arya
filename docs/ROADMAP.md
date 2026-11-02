# After the hackathon: roadmap

What is not finished, said plainly. **Nothing on this page is built unless it
says so**, and nothing is promised for the submission. "Idea" means nobody has
designed it yet. Sources are named so you can check them.

## Devices
- **Ray-Ban Meta glasses.** Idea, raised by the owner for the store scan.
  Spark's check during the hackathon found no public live-camera API for
  third-party apps; the flow that works today is to capture on the glasses,
  sync to the phone and ingest the video there. The demo uses the phone camera
  throughout. Source: `docs/quest/DISCUSSION.md` (item 38).
- **Meta Ray-Ban Display glasses.** Idea. Not researched yet; what is possible
  depends on what Meta offers developers for that device.
- Both would reuse the shelf reading that exists today (SAM 3.1 plus Muse
  Spark). Live guidance on glasses is outside the spec for now (`SPEC.md`,
  "Not in scope").

## Store data and community
- **Capture more store data.** Item-level locations from scan captures,
  reports that close themselves, flags that expire when nobody confirms them,
  and mapping quietly from Find it for me frames. Source:
  `docs/quest/MAP-MY-STORE.md`, "Not built yet".
- **Arya shoppers and community prices.** Opt-in prices, deals and live
  presence (Quiet, Busy, Packed). Today the opt-in records a choice only. A
  community figure would need 5 or more households over 30 days, a median and
  no names. Source: `SPEC.md` FR-11.7, `SCALE-SIM.md`.
- **Quest community layer.** Leaderboards, badges the data makes funny, team
  Shop-Offs settled by receipt time and Clue Hunts. Designed, not built.
  Source: `docs/quest/GAME-DESIGN.md`.
- **Density first.** Win one metro's stores completely before expanding; a thin
  layer over many stores is worth little. Source: `docs/quest/BUSINESS.md`.
- Item and store profile pages; split the list (kids or a partner); friend run
  notifications (designed, not built); reimbursement tracking for items bought
  for others.
- Ideas for growth as a community product: invite links that land a new person
  in the same group, shared recipe or meal lists, and a public page for a
  store's map status. None designed.

## AI and open weights
- **Bring your own Meta key, finished.** Built but switched off in the live app
  (see the next section).
- **Replay mode** (recorded answers, so the AI parts work without a key).
  Planned, not built.
- **More use of open weights.** Muse Spark Open is a second seat on the staple
  judge and labels dictionary names today. Wider use would need the personal
  data rule kept (names only).
- A non-English Ask currently sends the whole feature guide (about 19 KB) on
  each question; trimming that is planned.

## Trust and privacy
- A photo opt-in and a full privacy policy; store permission for mapping.
  Source: `docs/quest/ARCHITECTURE.md`.
- Security review items that were deferred, tracked as GitHub issues.
- A community tier with user opt-in is an idea only
  (`assistant/docs/MODEL-POLICY.md`).
- Forgot-password flow and per-user spend caps are held, by choice
  (`ARCHITECTURE.md` section 13).
- The licence is undecided; the repository is all rights reserved for now
  (`LICENSE`).

## Running it yourself
- A Docker setup that runs on a laptop with a short env file and your own Meta
  key. Today the Compose file is the production one; see the README.
- Off-site backups with rclone (`ARYA_BACKUP_REMOTE` exists; no bucket is set
  up) and a staging address to check a deploy before the live one.
- Cost proposals from the cost watcher, tracked as GitHub issues.

## Use your own Meta key: built, switched off
The code is on `main`: a Settings row, a Help topic, an Ask answer and an
"I have my own Meta key" sign-up door. All of it stays hidden because it needs
a key vault secret (`ARYA_KEY_VAULT_SECRET`) that the live app does not have.
With no secret nothing is stored. It is off because there was not enough time
to finish and test it and the owner is still deciding how it should work.
To do: choose the account model (shared account with an optional key, or
key-only accounts), finish the Tester's pass, set the secret, add the guide
card. Operator notes: `assistant/docs/OPS.md`, "Own Meta keys". For someone
running Arya themselves, the key that matters today is `MODEL_API_KEY`, a
server key, not this feature.
