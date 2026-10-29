"""Agent-level simulation: every household is one object, every trip is
one event. Used for the 200 / 1,000 / 2,000 user stages, and to check the
aggregated model (model.py) that stands in for the large stages.

The store-map rules are NOT re-written here: the status of every shelf
segment comes from the real api.storemap (segment_status, select_best),
fed with simulated capture records and a simulated clock. Community
price and busyness rules follow the owner rules in SPEC FR-11.7: 5 or
more households, 30 days, median; under 3 shoppers shows Quiet.

Deterministic for a given (users, weeks, seed). No clock, no network,
no model calls, no data directory.
"""
import hashlib
import math
import random
import statistics
from datetime import datetime, timedelta

from api import storemap

from . import world as W

EPOCH = datetime(2026, 8, 3)       # a Monday; the simulated clock starts here
WEEKS = 12
STATUSES = ("unmapped", "mapped", "aging", "stale")


def _h(*parts):
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def _frac(*parts):
    return (_h(*parts) % 10000) / 10000.0


def _weighted(rng, pairs):
    total = sum(w for _, w in pairs)
    x = rng.random() * total
    for v, w in pairs:
        x -= w
        if x <= 0:
            return v
    return pairs[-1][0]


class Store:
    def __init__(self, spec):
        self.spec = spec
        self.name = spec["name"]
        n = spec["segments"]
        per_cat = max(1, n // len(W.CATEGORIES))
        self.segs = {}            # id -> segment dict (real storemap shape)
        self.by_cat = {c: [] for c in W.CATEGORIES}
        i = 0
        for c in W.CATEGORIES:
            for k in range(per_cat + (1 if i < n - per_cat * len(W.CATEGORIES) else 0)):
                sid = f"{c.lower()}-{k + 1}:both"
                self.segs[sid] = {"id": sid, "zone": sid.split(":")[0], "label": f"{c} {k + 1}",
                                  "side": "both", "captures": [], "stale": None,
                                  "baseline": None, "items": {}, "changed_at": EPOCH}
                self.by_cat[c].append(sid)
            i += 1
        self.carry = {}
        self.where = {}
        for it in W.ITEMS:
            iid, cat = it[0], it[2]
            p = {"Corner Market": 0.55, "Costco": 0.6, "Aldi": 0.7, "Trader Joe's": 0.8}.get(self.name, 0.93)
            self.carry[iid] = _frac(self.name, iid, "carry") < p
            segs = self.by_cat[cat] or list(self.segs)
            self.where[iid] = segs[_h(self.name, iid, "seg") % len(segs)]
        self.cat_factor = {c: spec["price"] * (0.95 + 0.10 * _frac(self.name, c, "pf")) for c in W.CATEGORIES}
        self.out_until = {}      # item -> week index it is back in stock
        self.out_since = {}
        self.presence = {}       # (week, dow, hour) -> count of presence shoppers
        self.trips = 0
        self.shopped = set()     # segments somebody has walked to

    def true_factor(self, item):
        return self.cat_factor[item[2]]


def _status_counts(store, now):
    c = dict.fromkeys(STATUSES, 0)
    for s in store.segs.values():
        c[storemap.segment_status(s, now)] += 1
    return c


def _accurate(store, now):
    """Share of segments whose best photo is newer than the last rearrangement."""
    ok = 0
    for s in store.segs.values():
        if s["id"] not in store.shopped:
            continue
        best = max(s["captures"], key=lambda c: c["at"], default=None)
        if best and datetime.fromisoformat(best["at"]) >= s["changed_at"]:
            ok += 1
    return ok / max(1, len(store.shopped))


def build_households(users, rng):
    stores = [s["name"] for s in W.STORES]
    pull = {s["name"]: s["pull"] for s in W.STORES}
    hh, n = [], 0
    arch_pairs = [(a, a["share"]) for a in W.ARCHETYPES]
    while n < users:
        a = _weighted(rng, arch_pairs)
        size = 1
        if rng.random() < W.ASSUME["group_share"] * 0.55:   # 0.55 ~ avg group size 2.5 -> ~18% of users
            size = rng.choice([2, 2, 3])
        size = min(size, users - n)
        weights = []
        for s in stores:
            base = a["prefer"].get(s, 0.15) * pull[s]
            weights.append((s, base * rng.lognormvariate(0, 0.5)))
        members = [{"mapper": rng.random() < W.ASSUME["mapper"],
                    "presence": rng.random() < W.ASSUME["share_presence"]} for _ in range(size)]
        items = {}
        for it in W.ITEMS:
            p = min(1.0, it[5] * (0.55 + 0.6 * a["basket"]))
            if rng.random() < p:
                cad = it[4] * rng.uniform(0.7, 1.4)
                items[it[0]] = {"cad": cad, "last": -rng.uniform(0, cad), "buys": []}
        hh.append({"id": len(hh), "arch": a, "weights": weights, "members": members,
                   "share_prices": rng.random() < W.ASSUME["share_prices"],
                   "items": items, "bulk_off": rng.randrange(4)})
        n += size
    return hh


def run(users, weeks=WEEKS, seed=W.SEED, raw=None):
    rng = random.Random(seed ^ (users * 7919))
    stores = {s["name"]: Store(s) for s in W.STORES}
    item_by_id = {it[0]: it for it in W.ITEMS}
    households = build_households(users, rng)
    group_hh = [h for h in households if len(h["members"]) > 1]
    A = W.ASSUME

    purchases = []          # (week, day, hh, store, item, unit_price)
    reports = []            # (day, store, item, hh, kind)
    trips_log = []
    photos = 0
    notfound = grabs = subs = 0
    series = []
    lapse = []              # per week: segment statuses of the spotlight store
    spotlight = "Trader Joe's"

    dow_pairs = [(i, w) for i, w in enumerate(W.DOW)]
    hour_pairs = list(W.HOUR.items())

    for wk in range(weeks):
        week_start = EPOCH + timedelta(days=7 * wk)
        # shelves get rearranged, items go out of stock
        for st in stores.values():
            for s in st.segs.values():
                if rng.random() < A["layout_change_per_week"]:
                    s["changed_at"] = week_start + timedelta(days=rng.random() * 7)
            for it in W.ITEMS:
                if st.carry[it[0]] and it[0] not in st.out_until and rng.random() < A["stockout_per_week"]:
                    st.out_until[it[0]] = wk + rng.choice([1, 1, 2])
                    st.out_since[it[0]] = wk * 7 + rng.random() * 7
            for iid in [i for i, u in st.out_until.items() if u <= wk]:
                st.out_until.pop(iid)
        # this week's trips, in time order
        events = []
        for h in households:
            a = h["arch"]
            n = int(a["trips"]) + (1 if rng.random() < a["trips"] - int(a["trips"]) else 0)
            for t in range(n):
                events.append((_weighted(rng, dow_pairs), _weighted(rng, hour_pairs), rng.random(), h))
        events.sort(key=lambda e: (e[0], e[1], e[2]))
        for dow, hour, minute, h in events:
            day = wk * 7 + dow
            now = week_start + timedelta(days=dow, hours=hour, minutes=minute * 60)
            a = h["arch"]
            bulk = bool(a["bulk_every"]) and (wk + h["bulk_off"]) % a["bulk_every"] == 0 and rng.random() < 0.5
            sname = "Costco" if bulk else _weighted(rng, h["weights"])
            st = stores[sname]
            member = rng.choice(h["members"])
            st.trips += 1
            if member["presence"]:
                key = (wk, dow, hour)
                st.presence[key] = st.presence.get(key, 0) + 1
            due = [(iid, e) for iid, e in h["items"].items() if day - e["last"] >= e["cad"] * rng.uniform(0.8, 1.05)]
            if bulk:
                due = [(i, e) for i, e in due if item_by_id[i][2] in ("Household", "Pantry", "Frozen", "Drinks", "Meat")]
            rng.shuffle(due)
            due = due[:int(8 + 22 * a["basket"])]
            passed = set()
            for iid, e in due:
                if not st.carry[iid]:
                    continue
                seg = st.segs[st.where[iid]]
                passed.add(seg["id"])
                st.shopped.add(seg["id"])
                out = iid in st.out_until
                best = max(seg["captures"], key=lambda c: c["at"], default=None)   # newest photo
                moved = seg["changed_at"] > now - timedelta(days=21) and seg["changed_at"] > EPOCH and (
                    best is None or datetime.fromisoformat(best["at"]) < seg["changed_at"])
                p_nf = 0.95 if out else (0.30 if moved else A["not_here"])
                if rng.random() < p_nf:
                    if rng.random() < A["report_rate"]:
                        notfound += 1
                        reports.append((day, sname, iid, h["id"], "stockout" if out else "moved"))
                        if moved and seg["stale"] is None:
                            seg["stale"] = {"at": now.isoformat(timespec="seconds"), "reason": "not found", "item": iid}
                    continue
                if rng.random() < A["substitute"]:
                    subs += 1
                grabs += 1
                e["last"] = day
                price = (item_by_id[iid][3] * st.true_factor(item_by_id[iid])
                         * (1 + 0.004 * wk) * rng.uniform(0.97, 1.03)
                         * (0.85 if rng.random() < 0.12 else 1.0))
                p = round(price, 2)
                e["buys"].append(day)
                purchases.append((wk, day, h["id"], sname, iid, p))
            for sid in rng.sample(list(st.segs), min(len(st.segs), rng.randint(1, 4))):   # browsing
                passed.add(sid)
                st.shopped.add(sid)
            trips_log.append((wk, dow, hour, sname, h["id"]))
            # mapper takes a photo of the neediest shelf on the way
            if member["mapper"] and passed and rng.random() < A["capture_per_trip"]:
                order = {"unmapped": 0, "stale": 1, "aging": 2, "mapped": 3}
                seg = min((st.segs[i] for i in passed),
                          key=lambda s: (order[storemap.segment_status(s, now)], rng.random()))
                score = round(min(0.95, max(0.15, rng.betavariate(5, 2.2))), 4)
                cap = {"id": f"c{photos}", "at": now.isoformat(timespec="seconds"), "kind": "photo",
                       "by": f"u{h['id']}", "score": score, "weak": score < 0.4,
                       "dhash": "%016x" % (rng.getrandbits(64) if rng.random() < 0.7 else _h(seg["id"], "v", rng.randrange(3)))}
                twin = next((c for c in seg["captures"] if storemap.hamming(cap["dhash"], c["dhash"]) <= storemap.DUP_HAMMING), None)
                if twin:
                    twin["at"] = cap["at"]
                else:
                    seg["captures"] = storemap.select_best(seg["captures"] + [cap], now=now)
                seg["stale"] = None
                photos += 1
        end = week_start + timedelta(days=7)
        row = {"week": wk + 1}
        row["coverage"] = {n: _status_counts(s, end) for n, s in stores.items()}
        row["accuracy"] = {n: round(_accurate(s, end), 3) for n, s in stores.items()}
        series.append(row)
        sp = stores[spotlight]
        lapse.append([storemap.segment_status(s, end) for s in sp.segs.values()])

    if raw is not None:
        raw.update(purchases=purchases, households=households, trips=trips_log, stores=stores)
    return _summarise(users, weeks, households, group_hh, stores, purchases, reports, trips_log,
                      photos, notfound, grabs, subs, series, lapse, spotlight, item_by_id)


def _community(purchases, households_opt, wk_end, k=None, days=None):
    """Median unit price per (store, item) from opted-in households over the
    last `days` days, shown only when `k` or more distinct households bought."""
    k = k or W.ASSUME["community_k"]
    days = days or W.ASSUME["community_days"]
    day_end = wk_end * 7
    cells = {}
    for (wk, day, h, s, i, p) in purchases:
        if wk < wk_end and day > day_end - days - 1 and households_opt[h]:
            cells.setdefault((s, i), []).append((h, p))
    out = {}
    for key, rows in cells.items():
        if len({h for h, _ in rows}) >= k:
            out[key] = statistics.median(p for _, p in rows)
    return out


def _summarise(users, weeks, households, group_hh, stores, purchases, reports, trips_log,
               photos, notfound, grabs, subs, series, lapse, spotlight, item_by_id):
    A = W.ASSUME
    opt = {h["id"]: h["share_prices"] for h in households}
    # community prices over time
    price_series = []
    truth = {(s, it[0]): stores[s].true_factor(it) * it[3] for s in stores for it in W.ITEMS if stores[s].carry[it[0]]}
    for wk in range(1, weeks + 1):
        cm = _community(purchases, opt, wk)
        items_cmp = {}
        for (s, i), p in cm.items():
            items_cmp.setdefault(i, {})[s] = p
        compare = {i: v for i, v in items_cmp.items() if len(v) >= 2}
        right = sum(1 for i, v in compare.items()
                    if min(v, key=v.get) == min((s for s in stores if (s, i) in truth), key=lambda s: truth[(s, i)]))
        err = [abs(p / truth[k] - 1) for k, p in cm.items() if k in truth]
        price_series.append({"week": wk, "cells": len(cm), "items_with_compare": len(compare),
                             "cheapest_right": right, "median_error_pct": round(100 * statistics.median(err), 1) if err else None})
    # one product as a shopper sees it: median per store, and how many households stand behind it
    sample = {}
    for iid in ("milk", "eggs", "coffee", "bananas"):
        row = {}
        for sname in stores:
            rows = [(h, p) for (wk, day, h, s2, i2, p) in purchases
                    if s2 == sname and i2 == iid and wk < weeks and day > weeks * 7 - 31 and opt[h]]
            hs = {h for h, _ in rows}
            row[sname] = {"households": len(hs),
                          "median": round(statistics.median(p for _, p in rows), 2) if len(hs) >= A["community_k"] else None}
        sample[iid] = {"name": item_by_id[iid][1], "stores": row}
    # what one household can see from its own receipts alone (2+ stores, last 60 days)
    own_cmp = own_total = 0
    by_hh = {}
    for (wk, day, h, s, i, p) in purchases:
        if day > (weeks * 7) - 60:
            by_hh.setdefault(h, {}).setdefault(i, set()).add(s)
    for h in households:
        items = by_hh.get(h["id"], {})
        own_total += len(items)
        own_cmp += sum(1 for v in items.values() if len(v) >= 2)
    # busyness
    busy = {}
    levels = {"Quiet": 0, "Busy": 0, "Packed": 0}
    signal = total_slots = 0
    heat = {}
    for n, st in stores.items():
        grid = [[0.0] * len(W.HOUR) for _ in range(7)]
        hours = sorted(W.HOUR)
        for (wk, dow, hour), c in st.presence.items():
            grid[dow][hours.index(hour)] += c
        # average concurrent Arya shoppers in the hour = trips started that hour x trip length
        avg = [[v / weeks * A["trip_minutes"] / 60 for v in row] for row in grid]
        heat[n] = avg
        for wk in range(weeks):
            for dow in range(7):
                for hour in hours:
                    c = st.presence.get((wk, dow, hour), 0) * A["trip_minutes"] / 60
                    total_slots += 1
                    if c < 3:
                        levels["Quiet"] += 1
                    else:
                        signal += 1
                        levels["Packed" if c >= 8 else "Busy"] += 1
    # running low: median-interval predictor, scored against the next week
    sugg = hit = bought_next = caught = 0
    cut = (weeks - 1) * 7
    for h in households:
        for iid, e in h["items"].items():
            before = [d for d in e["buys"] if d < cut]
            after = any(cut <= d < cut + 7 for d in e["buys"])
            if len(before) >= 3:
                bought_next += after
                gaps = [b - a for a, b in zip(before, before[1:])]
                due = cut - before[-1] >= statistics.median(gaps) * 0.9
                if due:
                    sugg += 1
                    hit += after
                    caught += after
    # missing-item alerts: 3 households, 7 days
    alerts = true_alerts = 0
    seen = {}
    for (day, s, i, h, kind) in sorted(reports):
        seen.setdefault((s, i), []).append((day, h, kind))
    detected = set()
    lags = []
    for (s, i), rs in seen.items():
        for idx, (d0, _, _) in enumerate(rs):
            win = [r for r in rs[idx:] if r[0] - d0 < 7]
            if len({r[1] for r in win}) >= A["alert_reports"]:
                alerts += 1
                if any(r[2] == "stockout" for r in win) or any(r[2] == "moved" for r in win):
                    true_alerts += 1
                detected.add((s, i, int(d0 // 7)))
                break
    episodes = sum(len(st.out_since) for st in stores.values())
    spot = stores[spotlight]
    final_cov = series[-1]["coverage"]
    return {
        "users": users, "households": len(households), "groups": len(group_hh),
        "group_users": sum(len(h["members"]) for h in group_hh),
        "weeks": weeks, "trips": len(trips_log), "receipt_lines": len(purchases),
        "photos": photos, "not_here": notfound, "substitutes": subs, "grabs": grabs,
        "stores": [s["name"] for s in W.STORES],
        "map": {"series": series, "final": final_cov, "lapse": lapse, "spotlight": spotlight,
                "spotlight_segments": [s["label"] for s in spot.segs.values()]},
        "prices": {"series": price_series, "sample": sample,
                   "opted_in_households": sum(opt.values()),
                   "own_compare_pct": round(100 * own_cmp / own_total, 1) if own_total else 0.0},
        "busy": {"levels": levels, "signal_pct": round(100 * signal / total_slots, 1), "heat": heat,
                 "hours": sorted(W.HOUR)},
        "low": {"suggestions": sugg, "precision_pct": round(100 * hit / sugg, 1) if sugg else None,
                "recall_pct": round(100 * caught / bought_next, 1) if bought_next else None},
        "alerts": {"alerts": alerts, "stockout_episodes": episodes, "reports": len(reports),
                   "top": _top_missing(reports, item_by_id)},
    }


def _top_missing(reports, item_by_id, n=6):
    c = {}
    for (_d, s, i, _h, kind) in reports:
        c[(s, i)] = c.get((s, i), 0) + 1
    return [{"store": s, "item": item_by_id[i][1], "reports": v}
            for (s, i), v in sorted(c.items(), key=lambda kv: -kv[1])[:n]]
