# 2026-11-01 "I finished it" on Still good?

Owner asked (screenshot of Today's Still good? card) for a third answer next to Still good and It expired. Mockup claude.ai/artifact/793rf74DCQXXiGNbfVw8qj approved, with the finished item going back on the list.

- `screens/Today.tsx`: third chip "I finished it" (`data-check-finished`). It posts `/api/items/{id}/flag {out: today}`: Arya's existing "I'm out" flag, so no backend change. The item leaves the checks (home.py skips an item whose out/expired date is on or after the last purchase), goes on the list (state.py `out_now`), and is not waste (Food waste counts `expired` only). Toast "Finished. {name} is on your list for next time." with Undo (`{out: null}`).
- The three answers are equal-width in one row (`.checkchips`); at 360 px each is 93 px wide, in one row.
- Help (Use soon n1), guide card Use soon step 4, and Ask knowledge name the three answers.

Tests: test_list_first (chip, flag body, Undo, row class), test_list_overhaul (finished leaves the checks and is not expired). vitest 481 pass; Python failures identical by name to main. Demo run at 360x640 and 390x844 with this build: chip in one row, tap posts {"out": today}, toast with Undo, no page errors. Screens: /mnt/project-files/arya-finished-build/.
