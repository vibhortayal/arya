# Scale simulator

A standalone tool that shows what Arya looks like at 200, 1,000, 2,000, up to 5,000,000 users.
All data is simulated. The tool never reads or writes real user data and never calls a model.

Open `docs/scale-sim/index.html` in a browser. Pick a user count with the stage buttons or the slider.
Pick how many users share one neighbourhood (200, 1,000, 5,000). The page shows two views:

- **What shoppers see:** store maps filling in from fog (week by week), community price compare,
  Arya Shoppers busyness, running low, missing-item alerts.
- **What the system does:** which limits strain or break, what each fix is, what it costs per month.

## What is measured, simulated, and assumed

| Mark | Meaning | Where |
|---|---|---|
| M | Measured on the real code, with simulated households | `measure.py` writes `calibration.json` |
| S | Simulated agent by agent (100 to 10,000 users per neighbourhood) | `agents.py` |
| A | Assumption or arithmetic (100k to 5M users, cost, Postgres) | `model.py`, `world.py` |

Nobody simulated 5,000,000 people one by one. For large stages, data quality comes from the
neighbourhood-size simulation, and system numbers come from arithmetic on the measurements.

The agent simulation uses the real `api/storemap.py` functions (`segment_status`, `select_best`)
with a simulated clock. Community price rules follow SPEC FR-11.7 (5 or more households, 30 days, median).
Arya Shoppers and community prices are NOT built in the app; the simulator models them.

## Run it

```
python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt
cd assistant
../.venv/bin/python -m harness.scalesim.measure --users 1000 --out harness/scalesim/calibration.json
../.venv/bin/python -m harness.scalesim.build        # writes docs/scale-sim/index.html
```

`measure` writes households into a throw-away temp folder and refuses to use the live data folder.
It starts the real API with `ARYA_STORE=json` and times it. Postgres is not measured.
The load client runs on the same machine as the API, so the request rates are a lower bound.

## What the measurement found (1,000 users, 872 accounts, 4 cores, one process)

- One API process holds about 70 requests per second under load (111 with one client).
- The shared store map keeps all photos in ONE JSON file. Every new photo rewrites the whole file.
  Cost grows with the number of photos on the whole platform.
- `sessions.json` is read whole on every request.
- The Today screen is recomputed from all receipts on every read (26 ms per household at 12 weeks).

## Demo

See the "Showing it in the demo" tab of the report. Say that it is a simulation. Do not call the
users real, and do not show community prices or Arya Shoppers as shipped.
