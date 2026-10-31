# Demo Town

The demo household reads as if hundreds of Arya shoppers live around it. Neighbours report items
out of stock, stores closed, busy hours and community prices. All of it is SIMULATED, labelled
"Simulated" on every screen, and never reaches a real account.

## Turn it on

1. Set `ARYA_DEMO_TOWN=1` in `deploy/.env` (default `0`).
2. Rebuild and rerun `python -m harness.make_demo_household data`. With the flag on, the household
   shops at invented stores: Trader Jill's, Safeday, Costcozy, Aldo's, Targot, Sprout Street,
   Whole Meadows, Corner Market (`api/town.py` NAMES). The Costcozy list also gets eggs.
3. Open the demo. The demo bar says "simulated neighbourhood".

With the flag off nothing changes: no routes, no chips, real-style names in the demo.

## What it shows

- **Today:** "Near you today": items reported out, a store reported closed, a quiet store, the
  cheapest milk.
- **Lists:** a chip on an item reported out at the list's store, a heads-up card, and a sheet
  with who says what and one tap to move the item to the store that has it.
- **Start shopping:** a store reported closed shows the report ("not confirmed by the store"),
  the nearest open store, and report buttons.
- **Director** (open the app with `?director=1`, then Settings): stage "Eggs run out", "Store
  closes", "Saturday rush", "Incident", or Reset. Staged moments live in the demo sandbox only.

## Rules (SPEC FR-11.7 and the owner's design)

| Report | Needs | Shows for |
|---|---|---|
| Out of stock | 3 households within 24 hours | 24 hours |
| Closed or incident | 3 households within 2 hours | 6 hours, "not confirmed by the store" |
| Community price | 5 households over 30 days | median only |

The town keeps its own clock: outside 10:00-20:00 local it reads 11:00 of the same day, so a judge who opens the demo at night still finds the stores open.

Nobody is named. A visitor's own report counts as one household, so a judge can watch the rule work.
"I see them here" cancels one "out" report.

## How it is built

- `demo_town/town.json`: the pack. Built by `python -m harness.scalesim.make_town` from the scale
  simulator (800 shoppers, seed in `world.py`). Deterministic; committed.
- `api/town.py` and `api/routes/town.py`: rules, clock and routes. Served only to the demo
  account and only when the flag is on; anyone else gets 404.
- `GET /api/town/hints`, `POST /api/town/director`, `POST /api/town/report`.
- A visitor's reports and Director moments live in the demo sandbox (in memory). Nothing is
  written to the household data, the ledger, the dictionary or the store map.
- `web/src/lib/town.ts`, `web/src/ui/Town.tsx`: the screens' side.
- Same data model as the real community feature will use; the routes would then read real reports.

## Known limit

No store ships with a map, so a Demo Town store such as "Trader Jill's" plays as a labelled
typical layout, like every other unmapped store.
