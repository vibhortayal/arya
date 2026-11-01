# 2026-11-01 Tour fixes (owner's six screenshots)

Owner tested the demo Tour on a phone and listed six problems. All fixed; the Tour stays at 19 steps.

1. Today steps (Running low, Your lists, Use soon) showed no highlight and the bubble covered the card. Cause: every step's `onEnter` calls `nav.tab`, and a new view scrolls to its top after it renders, undoing the Tour's `scrollIntoView`. Fix (`ui/Tour.tsx`): look for the target two frames after `onEnter`, scroll so the target and the bubble both fit (a "below" step's card near the top), and check again at 350 ms and 900 ms for late cards. Use soon now puts its bubble below the card.
2. Back: every step after the first has `‹ Back`. In the per-screen Tour, Skip tour moved to an × in the top row so Back, Skip Today and Next fit on a 390 px phone.
3. More step showed Ask's screen with Ask lit. It now opens the More sheet, highlights it, and lights More (`openMoreSheet`, closed by the step's new `onLeave`).
4. "Make the bar yours" drew a white box over the bar and said touch and hold. It now opens More and points at Customize bar; the line says to tap it. Customize now still opens the editor.
5. Today's line said "Receipts and Spending are on Lists" even when Receipts was pinned. `todayLine(bar)` now names only what is in More, or nothing.
6. Full bar: the green plus buttons are greyed out and the editor says "The bar holds four. Remove one first." (`EditList` `full`).

Help, guide card, More hint and `arya_features.md` lead with More › Customize bar (touch and hold still works).

Tests: new Tour tests (Back, onLeave, ×, Today line, More/bar steps) and full-bar test; vitest green (pack timing test flaky under load, passes alone); Python has the same 12 failures as main. Demo run at 390x844 with this build against the live demo's data: all 19 steps highlight their target with no bubble overlap; Back from the last step; Customize now opens the editor; no page errors.
