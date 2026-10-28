# Build plan — to Nov 4, 2026, 9:00 PM ET

The VGGT spike passed on Oct 27 (90 frames of a Trader Joe's aisle
stretch). The full loop shipped beyond the original mini-hunt scope.

## Done
| When | Work |
| --- | --- |
| Oct 27 | Engine Stages A–E, cloud driver, wireframes approved, intake parity, Brain restyle, shelf graph, Shelf Scan, localizer, photo-walk default |
| Oct 28 | Hardening, demo sandbox, Hunt v2 rebuild (PR #16) |
| Oct 28 | Game upgrade on PR #18: installable PWA, offline grabs, points and levels with no clock, How to play, one view, Find it for me, people scrub, Plan a hunt |

## Next
| When | Work |
| --- | --- |
| Oct 29–31 | Owner phone pass on PR #18; merge and deploy; demo data and walk-photo scrub on the VM; Split the list if time allows |
| Nov 1 | **Feature freeze** |
| Nov 1–2 | QA sweep: Playwright over every screen on the demo household and a test account; Muse Wonder reviews screenshots against the wireframes and files findings; each finding verified before a fix lands |
| Nov 3 | Demo video filmed in the store during a real shop; submission package |
| Nov 4 | Owner reviews the package; submit before 9:00 PM ET on his go-ahead |

## Out of scope (rollout story)
Whole-store maps, continuous tracking, the escape-room skin, public
registration, global boards, mapper leaderboards, photo opt-in policy.

## Risks
- Phone performance: the graph carries the logic; photos and cloud
  are only the look.
- Time: if anything slips, cut features, never the receipt finish.
