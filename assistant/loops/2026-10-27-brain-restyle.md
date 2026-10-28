# Brain restyle — 2026-10-27 (night)

**Scope.** Restyle the Brain screens of the PWA to the approved
wireframes (artifact `arya-quest-wireframes`, Brain B1–B6 + the
decluttered Today; DISCUSSION entries 20–27). Built on top of
Intake parity (Stage 6) — the five Add doors, the Ask mic path,
and the invariant line are unchanged. scene.js, quest.js, api/,
and pwa/models/ were not touched.

**What changed** (commits `3be9bd6` shell, `2f9fb4b` renderers):
- Navigation is the wireframe's five tabs — Today / List / Add /
  Ask / Profile — with the wireframe's inline-SVG icon set
  (compass, list-check, plus-circle, chat-spark, person). The
  Dashboard tab is gone; Dashboard became Analysis (B5), reached
  from Profile. SW cache arya-v16.
- **Today:** greeting (weekday + date), ONE hero card for the
  resumable hunt (Resume is the screen's only primary button),
  compact "Your games" rows reusing the quest session plumbing,
  one "Needs your eye · N" row (N = review lines + unresolved +
  Curator proposals) shown only when N > 0, and the smart list as
  one plain-text line in the owner's format. No money, no
  Community/Profile cards (both live behind Profile now).
- **B1 List:** its own tab now. Store lens (All / per-store chips)
  built from purchase history — /api/items/{id} price_by_store is
  the affinity source; store slice first under "Your <store>
  list", the rest muted under "Could grab here too"; store tags
  on rows in the All lens; add box + qty steppers in every state.
  Prepared cart and the Worth-a-look notes (Eyes "seen" rows +
  still-good/expired checks) moved here from Today.
- **Restored handlers:** the list-row actions (check, stepper,
  remove), the check buttons (still good / it expired), and the
  old Home add-picker had NO click handlers anywhere — the
  endpoints always existed; the Stage 6 file split dropped the
  handlers (same incident as bindItemLinks). All are wired now,
  one delegation across every lens; check-off is the same global
  flag in all of them.
- **B3 Ask:** confirmed actions render as accent chips
  ("✓ <server's applied line>") under the reply, as the wireframe
  shows; skipped actions stay muted lines.
- **B4 Receipts:** new view — Needs-your-eye on top (the review
  queue and Curator containers moved here from Add; renderers and
  handlers unchanged), then the archive; rows open the receipt
  detail (quest.js openReceipt). No spend content.
- **B5 Analysis:** from Profile. Spend panel: latest month total
  (dashboard spend_by_month), receipts filed that month (archive),
  Returns netted — labeled "all receipts" because the API reports
  returns only as an all-time total and monthly spend gross of
  returns; all-time spend, by-month bars, by-store, top items.
  Patterns and Trends are greyed "Coming next" panels. No top
  categories — the API has no category data (gap, below).
- **B6 Profile:** ONE profile — Quest player card (@handle, Hunts
  / Receipts / Streak tiles, Spots reported + Eagle Eye rows,
  badge shelf tiles, Mapped-by-you) merged with the account
  Profile (signed-in-as, Muse token card with the invariant
  line, Appearance System/Light/Dark, receipt archive row).
  view-qprofile remains in the shell for quest.js's bindings but
  nothing navigates to it; the tab Profile is the only profile.

**Verification.** Suite: 126 green (116 + 10 new in
tests/test_brain_restyle.py: shell contract — tab set, views,
no stock chrome emojis, hooks — plus the lens/analysis/Today
data shapes). Headless-Chromium serve smoke against a locally
seeded account (4 structured receipts, 2 stores, 1 playing
session): 40 checks passed — hero/Resume/state line, the list
line's exact format, lens chips + grouping + dual store tags,
global check-off across lenses, stepper, add/remove, doors
intact, unified Profile, Analysis month total ($32.96 = October
dashboard spend), receipts archive → detail, zero page errors.
One smoke find fixed in-slice: Analysis's back arrow used the
quest stack fallback (Today); it now returns to Profile, as the
wireframe has it.

**Gaps (honest subset — nothing fabricated):**
- Analysis "Top categories" has no API source; the panel shows
  Top items + Spend by store instead.
- Analysis cannot show the wireframe's "returns netted this
  month, already taken out of the total": the dashboard API
  exposes returns only all-time and monthly spend gross of
  returns. The returns row is labeled "All receipts".
- Profile "Mapped by you" has no data source: /api/quest/profile
  returns mapped_stores: [] (no mapper-credit field exists yet),
  so the section renders its empty state. Mapper credit and the
  member-since/place lines on the wireframe's player card are
  likewise unbacked and omitted.
- Manual (by-name) list adds carry no store until the item is
  bought somewhere: they appear in the All lens untagged and in
  "Could grab here too" under every store lens — affinity is
  learned from receipts, never guessed.
- Ask's action chips use the server's applied-action sentences
  (chat_service), not the wireframe's demo wording.

**Costs.** No model calls ($0). **Not deployed** — parent reviews,
pushes, deploys (git pull on the VM).

**Next.** Owner phone pass on Today/List/Profile; the Analysis
category + per-month returns figures need an API addition if the
owner wants the wireframe's exact panel (api/ is out of this
stage's scope).
