"""Build the Demo Town pack (assistant/demo_town/town.json).

  python -m harness.scalesim.make_town [--users 800]

Runs the agent simulation for one neighbourhood (hundreds of shoppers)
and writes what the demo needs: store hours and busy curves, which
stores carry which items, community prices (5-household rule applied),
a few curated reports, and the Director's scenarios. Deterministic: the
same seed gives the same file. SIMULATED data; store names are invented.
"""
import argparse
import json
import os
import statistics

from api import town

from . import agents, world as W

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "demo_town", "town.json")

# (key, name shown, words that match a list item's name, sim item id or None, base price if extra)
ITEMS = [
    ("organicmilk", "Organic Milk 0.5 gal", ["organic milk"], None, 4.6),
    ("milk", "Whole Milk 1 gal", ["milk"], "milk", None),
    ("eggs", "Eggs 12 ct", ["egg"], "eggs", None),
    ("spinach", "Baby Spinach 16 oz", ["spinach"], "spinach", None),
    ("yogurt", "Greek Yogurt 32 oz", ["yogurt"], "yogurt", None),
    ("coffee", "Coffee Beans 12 oz", ["coffee"], "coffee", None),
    ("rice", "Jasmine Rice 10 lb", ["rice"], "rice", None),
    ("pasta", "Pasta 1 lb", ["pasta"], "pasta", None),
    ("chicken", "Chicken Breast", ["chicken"], "chicken", None),
    ("bread", "Sourdough Loaf", ["bread", "sourdough"], "bread", None),
    ("bananas", "Bananas", ["banana"], "bananas", None),
    ("papertowel", "Paper Towels 6 ct", ["paper towel"], "paper_towel", None),
    ("avocado", "Avocados 4 ct", ["avocado"], "avocado", None),
    ("hummus", "Hummus 10 oz", ["hummus"], None, 3.9),
    ("basil", "Fresh Basil", ["basil"], None, 2.9),
    ("batteries", "AA Batteries 8 ct", ["batter"], None, 9.5),
]
HOURS = {"Trader Jill's": (8, 21), "Safeday": (6, 23), "Costcozy": (10, 20.5), "Whole Meadows": (7, 22),
         "Aldo's": (9, 20), "Targot": (8, 22), "Sprout Street": (7, 21), "Corner Market": (7, 22)}
NEAR = {"Safeday": 1, "Trader Jill's": 2, "Costcozy": 3, "Aldo's": 4, "Targot": 5,
        "Sprout Street": 6, "Whole Meadows": 7, "Corner Market": 8}


def build(users):
    raw = {}
    agents.run(users, raw=raw)
    fic = {s["name"]: town.NAMES[s["name"]] for s in W.STORES}
    stores_by_name = raw["stores"]
    opt = {h["id"]: h["share_prices"] for h in raw["households"]}
    week_end = agents.WEEKS
    # community prices: median per (store, item) from opted-in households, last 30 days
    cells = {}
    for (wk, day, h, s, i, p) in raw["purchases"]:
        if wk < week_end and day > week_end * 7 - 31 and opt[h]:
            cells.setdefault((s, i), []).append((h, p))
    last_week = {}
    for (wk, day, h, s, i, p) in raw["purchases"]:
        if wk == week_end - 1:
            last_week.setdefault((s, i), set()).add(h)
    # store busy curves: that store's trips by weekday and hour, scaled to its own peak
    grid = {s: [[0] * 24 for _ in range(7)] for s in stores_by_name}
    for (wk, dow, hour, s, h) in raw["trips"]:
        grid[s][dow][hour] += 1
    stores = []
    for spec in W.STORES:
        n = spec["name"]
        top = max(max(r) for r in grid[n]) or 1
        stores.append({"name": fic[n], "opens": HOURS[fic[n]][0], "closes": HOURS[fic[n]][1],
                       "near": NEAR[fic[n]], "busy": [[round(v / top, 3) for v in r] for r in grid[n]]})
    extra_rng = agents.random.Random(W.SEED ^ 0x70)
    stock, deal = {}, None
    sim_items = {it[0]: it for it in W.ITEMS}
    for key, name, _m, sim_id, base in ITEMS:
        row = {}
        for spec in W.STORES:
            n = spec["name"]
            st = stores_by_name[n]
            if sim_id:
                carried = st.carry[sim_id]
                rows = cells.get((n, sim_id), [])
                hs = len({h for h, _ in rows})
                price = round(statistics.median(p for _, p in rows), 2) if hs else None
                bought = len(last_week.get((n, sim_id), ()))
            else:
                carried = agents._frac(n, key, "carry") < 0.85
                hs = extra_rng.randint(6, 40) if carried else 0
                price = round(base * st.cat_factor["Pantry"] * extra_rng.uniform(0.97, 1.03), 2) if carried else None
                bought = extra_rng.randint(1, 9) if carried else 0
            row[fic[n]] = {"in": bool(carried), "price": price, "households": hs, "bought_today": max(1, bought // 2) if carried else 0}
        stock[key] = row
    milk = {s: v for s, v in stock["milk"].items() if v["in"] and v["price"] and v["households"] >= 5}
    cheap = min(milk, key=lambda s: milk[s]["price"])
    deal = {"item": "Whole Milk 1 gal", "store": cheap, "price": milk[cheap]["price"], "households": milk[cheap]["households"]}
    reports = [{"kind": "out", "store": "Trader Jill's", "item": "hummus", "minutes_ago": 55, "households": 3}]
    scenarios = {
        "eggs_out": [{"kind": "out", "store": "Costcozy", "item": "eggs", "minutes_ago": 40, "households": 4}],
        "closes": [{"kind": "closed", "store": "Trader Jill's", "minutes_ago": 25, "households": 3,
                    "note": "Water main break"}],
        "rush": [{"kind": "rush", "store": "Safeday", "minutes_ago": 5, "households": 1}],
        "incident": [{"kind": "incident", "store": "Aldo's", "minutes_ago": 20, "households": 3,
                      "note": "Police activity at the entrance. One door is closed."}],
    }
    return {
        "label": "Simulated", "neighbours": users, "seed": W.SEED, "tz_offset_h": -7,
        "note": "Built by harness/scalesim/make_town.py from the scale simulator. Store names are invented.",
        "stores": stores,
        "items": [{"key": k, "name": n, "match": m} for k, n, m, _s, _b in ITEMS],
        "stock": stock, "reports": reports, "scenarios": scenarios, "deal": deal,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=800)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    pack = build(a.users)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(pack, f, separators=(",", ":"), sort_keys=True)
    print(f"wrote {a.out}: {os.path.getsize(a.out) / 1024:.0f} KB, {len(pack['stores'])} stores, {len(pack['items'])} items")


if __name__ == "__main__":
    main()
