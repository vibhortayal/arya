# Build plan

Deadline: Nov 4, 2026, 9:00 PM ET. `STATUS.md` at the repo root says what
is true on `main`; this page keeps only the plan and what is left.

## Shipped (Oct 27 to Oct 29)

| When | Work |
| --- | --- |
| Oct 27 | Engine stages A to E, wireframes approved, intake parity, Brain restyle |
| Oct 28 | Hardening, demo sandbox, Hunt v2 rebuild, installable PWA, offline grabs, points and levels with no clock, Find it for me, people scrub |
| Oct 29 | List-first redesign, named lists, price intelligence, Groups with live sync, React app at `/` (#165), Quest mode with simulated stores and Build (#172 to #176), Map my store with a guided scan, first-run tour and Arya guide, Demo Town, labels audit, log caps and nightly backups |

## Left

- Deploy what is merged (owner steps in `STATUS.md`).
- By Nov 4: set the Ops "Photo reader" switch to "Spark first, Wonder as
  backup" (auto) for judging (owner, 2026-11-01), and keep the demo daily
  budget at $20. Before that, run `python3 -m harness.photo_reader_eval`
  on the Gate 0 photos once, so the reader is measured.
- After Nov 9: the Wonder amendment ends; decide Spark-only or keep auto.
- Demo video and the final submission package, on the owner's go-ahead.

## Out of scope for the hackathon

Whole-store maps, continuous tracking, the escape-room skin, public
registration, global boards, mapper leaderboards, the photo opt-in policy.

## Risks

- Phone performance: the store graph carries the logic; photos and the
  3D scene are only the look.
- Time: if anything slips, cut features, never the receipt finish.
