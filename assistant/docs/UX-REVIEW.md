# UX review — 2026-10-27

Dated review of the build as it stood on 2026-10-27. Finding 3 is
superseded: Muse Voice Transcribe replaced Web Speech. Finding 14 is
superseded: the visual system is now the wireframe theme (greyscale
structure, one orange accent), light mode only.

Method: full walkthrough of the live build at phone size (sign-in, demo
household, Home, Scan, Ask, Dashboard, item page, sign-out), a
control-by-control audit of the PWA against the API routes, and the
owner's own use of his account. Severity: S1 blocks the task, S2 misleads
or annoys, S3 polish.

## Findings

1. **S1 — The list had no controls.** A list row showed a name and a
   quantity. No add, no remove, no quantity change, no check-off. The
   only paths were the item page and chat. Fix: controls on every row
   (check, stepper, remove) and an add picker with tracked items and
   free text. API: /api/list/add|remove|qty|check|candidates. DONE.
2. **S1 — The review queue had no actions.** Unverified lines and
   unresolved names were display-only text. The queue could never be
   cleared, so it could only grow. Fix: confirm, rename (alternatives as
   one-tap chips, or free text; a rename teaches the dictionary), and
   resolve. API: /api/review/line|resolve. DONE.
3. **S1 — Ask Arya had no voice.** A grocery assistant used in a kitchen
   or a store must take voice. Fix: microphone input (Web Speech) with
   auto-send, spoken replies on a toggle (device TTS), and an honest
   fallback note when the browser has no speech recognition. DONE.
4. **S1 — The pattern analysis claimed cadences it could not support.**
   Two purchases 180 days apart read as "every ~180 days" ("Uber Fy24",
   an Uber gift-card line). Seasonal fruit read as due in October. Fix:
   the engine now reports facts only; a reasoning judge (Spark 1.3
   Standard) classifies each item (staple, seasonal, occasional,
   one-off, not a consumable) and gates list admission. Unjudged items
   stay off. The user's word always beats the judge. DONE.
5. **S2 — Running low bypassed the judge.** /api/home built running-low
   from all patterns, not the admitted set. Fixed: patterns carry an
   `admitted` flag; running-low uses it. DONE.
6. **S2 — Two SKUs of one product split the pattern.** "Eggs" were
   bought Oct 26 under SKU 2067305 while SKU 2067304 (also "Eggs") read
   76 days old, so eggs showed as due the day after a purchase. The
   import was correct; the identity model was not. Fix: SKUs that share
   a dictionary name group into one product for patterns, dashboard,
   and item pages. DONE.
7. **S2 — The prepared cart went stale.** It was prepared once and never
   changed when the list changed, and an approved cart never reset for
   the next cycle. Fix: a waiting cart re-prepares when list membership
   changes; checked items leave it; an approved cart re-prepares when a
   new receipt starts a new cycle. DONE.
8. **S2 — Raw receipt text as display names.** "Humm M/P Can",
   "Kirkland Signature Lbc", "Wildroots", "Mega Omega" reached the
   owner's list. Arya must not guess expansions. Fix: unclear names are
   marked unresolved; unresolved items stay off the list and wait in the
   review queue, where the owner settles each with one tap. DONE.
9. **S2 — Quantities rendered as floats** ("× 1.0"). Fix: whole numbers
   in the UI. DONE.
10. **S2 — Errors overwrote the header date.** All load errors wrote
    into the "as of" line. Fix: a toast line is the error surface. DONE.
11. **S2 — Chat in the demo failed with a raw error.** The demo is
    read-only; the Ask form still accepted text and showed a refusal.
    Fix: the Ask tab explains itself in demo mode and disables the
    form. DONE.
12. **S2 — Item flags replaced instead of merging.** The flag route
    overwrote the whole flag record, so one action could erase another.
    Fix: the route merges. DONE.
13. **S3 — Home rows were inert while Dashboard rows were links.** The
    same kind of row behaved two ways. Fix: running-low and list names
    open the item page everywhere. DONE.
14. **S3 — Visual system.** Serif display type on a paper ground, text
    tab bar, no dark mode, targets under 44 pt in places. Fix: full
    rebuild on the Apple UI design system (see DESIGN.md): system type,
    semantic colors, dark mode, grouped inset lists, icon tab bar with
    drawn SVG icons, pill actions, one quiet motion (view fade-rise).
    DONE.
15. **S3 — Item page hid the reasoning.** It showed cadence but not why
    an item is or is not suggested. Fix: the item page shows the judge
    class, its one-line reason, and the pattern verdict. DONE.

## Standing limits, stated honestly

- Seasonality is a judge input (purchase months), not a forecast.
- Web Speech recognition depends on the browser; iOS Safari and Chrome
  support it. Where it is absent, the keyboard microphone still works.
- The judge is cached per item and re-runs when purchases move by 2+;
  between runs, a brand-new kind of purchase waits for the next import
  hook, which judges pending items automatically.

## Addendum — screenshot walkthrough of the pre-fix build (same day)

An independent walkthrough (demo household, 21 screenshots) confirmed
findings 1, 2, 3, 10, 11, 13 from the app itself, and added:

16. **S2 — "Still good?" checks had no way to answer.** Fix: each check
    now carries "Still good" (acknowledged for the cycle) and "It
    expired" (the existing expired path). DONE.
17. **S2 — The cart asked for approval blind.** No items, no quantities.
    Fix: the cart section lists its items and states that approving
    places no order. DONE.
18. **S2 — Dashboard and item page disagreed.** Top items were gross of
    returns; item totals are net. Fix: top items are net of returns and
    the dashboard labels its period in human months ("May 2026", not
    "2026-05"). DONE.
19. **S3 — A price range of one price** ("$12.30 – $12.30"). Fix: a
    single price when min equals max; history is labelled "Recent".
    DONE.
20. **S3 — Demo Scan still offered live file pickers** while uploads
    were off. Fix: inputs disable in demo, like the buttons. DONE.
21. **Noted, not built:** forgot-password and show-password on the
    sign-in screen. Registration is closed and the pilot has exactly
    one account; a recovery flow with no mail channel behind it would
    be a fake affordance. Revisit if registration opens.
