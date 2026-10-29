# 2026-10-29 — List first, Quest second

**Ask (owner, 2026-10-29).** The landing page is too daunting. The core
value is grocery list management and shopping made simple: "Think of
our app as Waze for grocery shopping. Quest is the pokemon go part of
our app. we should not make quest as the hero." Move Quest to its own
tab. Wireframe approved before code (standing rule):
https://claude.ai/artifact/2cJpSnvyKCknaZ2XnpHk7y

**What changed.**
- Tabs: Today · Lists · Ask · Quest. The Crew tab is now the Quest tab
  (view id `view-community` is kept). Quest holds the level band, the
  hunt hero card, New hunt, Your games, Teach Arya your store, then the
  Crew rows, Fastest Hands and Badges.
- Today is the shopping dashboard: Running low (reason, On list / Add),
  Store alerts (crew "Not here" reports, and a cheaper store when your
  own receipts show a median gap of $0.25 or more; a labelled sample row
  when there is nothing yet), Use soon, Still good? checks (moved out of
  List), Needs your eye, Your lists cards (tap opens that list), Your
  patterns (month spend, opens Analysis, Back returns to Today), one
  quiet "Make your next run a Quest" row.
- Landing: "Groceries, sorted." with three real kinds of row as the
  picture; the cast strip is gone; Quest is one line under the button.
  How it works leads with the list.
- Back from a hunt lands on the Quest tab; ending a hunt returns there.
- SW arya-v77.

**Verification.** Suite: 1059 green (1050 + 9 new in
tests/test_list_first.py). Ran the demo household locally with
uvicorn at 390x844: landing, Today, Quest, list card to List; no
console errors.

**Costs.** $0 — no model calls; every row reads data Arya already holds.

**Gaps / next.** Inside the List tab is the List overhaul thread's work
(cards per list, suggestions with reasons, Prepared cart removed). The
List page title still says "List". README, PRODUCT.md and the
submission text still lead with the game.
