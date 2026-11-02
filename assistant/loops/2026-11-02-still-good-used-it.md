# 2026-11-02 Used it: off use-by, onto the suggested list

Ask (owner): the Still good? check only offered Still good or It expired;
add "Used it". Then (05:36Z): "Clicking on used it should remove it from
use by section, and it should put it in the suggested list option. If you
do undo, then it should remove it from the suggested list option and add it
back into the use by section." and "Only if it can't find a suggested list,
it should ask which list it should add it on."
Mockup: claude.ai/artifact/6XuF8PTfaAZAQWap8g2uss (v2).

Miss to learn from: the Oct 29 expiry mockup (Use soon) already had Used it
with add-back (#96). The Still good? mockup v1 copied that check's own
pattern instead of the existing Used it. Grep a button's existing handler
before mocking it somewhere new.

Built: Today.usedUp(), shared by Use soon (card chip and item sheet) and
Still good?. Untracks the date (Use soon), sets "out" today (Running low
learns), then lib/listPick addToUsual: the 409's "suggested" list straight
away, "Which list?" only when there is none. Undo: manual false, out null,
and the use-by date back. Help n1, Ask knowledge, tests updated.
