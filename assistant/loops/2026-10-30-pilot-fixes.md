# 2026-10-30 pilot test fixes (stage: polish)

Source: "Arya pilot: open issues" (retest 29 Oct 11 PM). All six were
still open on main @ #228. Fixed here: 3, 2, 4, 5.

- **Invite code (3):** the invite sheet no longer makes a new code on every
  open. `groups.invite()` returns the live code until it expires (48 h);
  only "Make a new code" (`{"new": true}`) replaces it. The registry keeps
  the code beside its hash so it can be shown again; the hours shown are
  the time left. Tests: test_groups.
- **Select mode (2):** rows are `role=checkbox` with `aria-checked`, and
  Enter or Space toggles the focused row. Test: selectkeys.test.tsx.
- **Long item names (4):** when nothing was added and pieces were left out
  (a ~190-character item), the toast says "Nothing added. An item is a
  short name (up to 60 characters), not a sentence." and the text stays in
  the box. The server now reports the skipped pieces on the model path too.
  Tests: test_add_surface, addtoast.test.ts.
- **Sign-in password (5):** closing the sheet clears the password.
  Test: login.test.tsx.

Not done, needs a mockup first: (1) demo exit, (6) 40px touch targets,
demo back button. "Try the demo" vs "Try it now": only "Try it now" exists
in the React landing on main.

Full suite: 4 failures, same as main (3 in test_demo_town, test_add_surface
single-surface shell check).

## Part 3: touch targets (issue 6)
The Today "Add Arya to your home" card: Install/Show how chip 36 -> 44 px
min-height, dismiss x 36 -> 44 px (negative margin keeps the card height).
Test: test_add_to_home_screen. Not done: the demo Back button. Back from the
first view leaves the app (by design since #220); making Back in the demo end
the demo would drop a visitor's state silently, so left for an owner call.
Landing pill stays 36 px (landing layout is another thread's).
