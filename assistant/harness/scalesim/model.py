"""System model: what N users do to Arya's API, database, storage and bill.

This is ARITHMETIC, not a measurement. Every input is one of:
  M  measured by harness/scalesim/measure.py on the real code (calibration.json)
  S  taken from the agent-level simulation (agents.py)
  A  an assumption written down below, with the reason

Nothing here is read from production. Change an assumption, rerun
`python -m harness.scalesim.build`, and the report updates.
"""
import json
import math
import statistics
import os

from . import world as W

HERE = os.path.dirname(__file__)

# ---- assumptions (A) -------------------------------------------------------
ASSUME = {
    "reqs_per_open": 4,              # Today + Lists + Analysis + Powers on each app open
    "opens_per_week": 4,             # per active user
    "reqs_per_trip": 25,             # list ticks, hunt steps, map taps while shopping
    "receipts_filed_per_trip": 0.6,  # share of trips that end with a filed receipt
    "ask_per_month": 3,              # Ask questions per user per month
    "peak_hour_share": None,         # filled from world.DOW / world.HOUR below
    "burst": 3.0,                    # peak minute vs peak-hour average
    "headroom": 0.6,                 # run a process at 60% of its measured ceiling
    "photo_mb": 0.22,                # phone shelf photo kept on the map (measured test photo: 0.17 MB)
    "keep_per_segment": 3,           # real constant, storemap.KEEP_PER_SEGMENT
    "stores_per_neighborhood": 8,
    "segments_per_store": 25,
    # prices: Meta Model API list prices in docs/MODEL-POLICY.md (verified 2026-10-27)
    "usd_receipt_decode": 0.02,      # measured anchors: 1.5 to 3.1 cents per photo/PDF
    "usd_photo_check": 0.005,        # people scrub + shelf-fill, two SAM 3.1 calls at $2.50 per 1,000
    "usd_ask": 0.01,                 # one Spark answer from precomputed facts
    "usd_per_core_month": 30.0,      # generic cloud vCPU, rounded; not a quote
    "usd_per_gb_db_month": 0.125,    # generic managed Postgres storage, rounded; not a quote
    "usd_per_gb_obj_month": 0.023,   # generic object storage, rounded; not a quote
    "pg_conn_limit": 200,            # pooler connections on a mid-size plan, assumed
    "pg_conn_per_process": 8,        # threadpool size per API process
    "presence_heartbeat_s": 60,
}
_dow, _hr = W.DOW, W.HOUR
ASSUME["peak_hour_share"] = (max(_dow) / sum(_dow)) * (max(_hr.values()) / sum(_hr.values()))

STAGES = [200, 500, 1000, 2000, 5000, 10000, 50000, 100000, 500000, 1000000, 2000000, 5000000]
DENSITIES = {"thin": 200, "typical": 1000, "dense": 5000}      # users per neighbourhood once N is large
QUALITY_GRID = [100, 200, 500, 1000, 2000, 5000, 10000]


def load_cal(path=None):
    p = path or os.path.join(HERE, "calibration.json")
    with open(p) as f:
        return json.load(f)


def density(n, preset):
    return min(n, DENSITIES[preset])


def nearest_grid(d):
    return min(QUALITY_GRID, key=lambda g: abs(math.log(g) - math.log(d)))


def system(n, preset, cal, agent_1k):
    """All the system numbers for n users. `agent_1k` is the agent-sim result
    at 1,000 users, used for per-user activity rates (S)."""
    A = ASSUME
    d = density(n, preset)
    hh_per_user = agent_1k["households"] / agent_1k["users"]
    trips_per_user_wk = agent_1k["trips"] / agent_1k["users"] / agent_1k["weeks"]
    lines_per_user_wk = agent_1k["receipt_lines"] / agent_1k["users"] / agent_1k["weeks"]
    photos_per_user_wk = agent_1k["photos"] / agent_1k["users"] / agent_1k["weeks"]
    api = cal["api"]
    # M: the ceiling of one API process on this machine
    cap_rps = statistics.median(l["rps"] for l in api["levels"] if l["concurrency"] >= 8)   # plateau under load, not the single-client peak
    usable_rps = cap_rps * A["headroom"]
    # requests
    reqs_wk = n * (A["opens_per_week"] * A["reqs_per_open"] + trips_per_user_wk * A["reqs_per_trip"])
    peak_rps = reqs_wk * A["peak_hour_share"] / 3600 * A["burst"]
    procs = max(1, math.ceil(peak_rps / usable_rps))
    # data (M for bytes per household, S for volume)
    hh = n * hh_per_user
    disk = cal["disk"]
    bytes_per_hh_12w = disk["bytes_per_household"]
    bytes_per_hh_1y = bytes_per_hh_12w * 52 / cal["weeks"]
    user_data_gb = hh * bytes_per_hh_1y / 1e9
    docs = n * 5
    # the receipts document is rewritten whole on every save (M: file layout, A: no append)
    receipts_doc_kb_1y = bytes_per_hh_1y * 0.8 / 1024
    # per-read cost grows with the household's own history (M: ms at 12 weeks; linear to a year)
    home_ms_12w = api["home_ms_per_household_median"]
    home_ms_1y = home_ms_12w * 52 / cal["weeks"]
    # sessions.json is read whole on EVERY request (M: size per session; A: ms per MB)
    sess_kb = disk["sessions_json_kb"] / max(1, disk["households"])
    sess_mb = sess_kb * n / 1024 * 3          # three signed-in devices per user, assumed
    sess_ms = sess_mb * 9.0                   # json.loads ~ 9 ms per MB (measured at build time)
    # shared store map (M: latency per MB of image file)
    stores = max(1, round(n / d)) * A["stores_per_neighborhood"]
    segs = stores * A["segments_per_store"]
    photos_wk = n * photos_per_user_wk
    kept = min(segs * A["keep_per_segment"], photos_wk * 12)                # photos on the map after 12 weeks
    img_mb = kept * A["photo_mb"] * 4 / 3                                  # base64
    sm = cal["storemap"]
    ms_per_mb = 1000.0 / sm["concurrent"]["captures_per_second"] / max(1.0, sm["bytes_one_store_30_segments"]["storemap_img.json"] / 1e6)
    ingest_ms = max(sm["ingest_ms_first_30"], ms_per_mb * img_mb)
    photo_peak_s = photos_wk * A["peak_hour_share"] / 3600 * A["burst"]
    photo_ceiling_s = 1000.0 / ingest_ms
    # presence
    conc = n * W.ASSUME["share_presence"] * trips_per_user_wk * A["peak_hour_share"] * W.ASSUME["trip_minutes"] / 60
    pres_wps = conc / A["presence_heartbeat_s"] * A["burst"]
    # model bill, per month (A prices)
    wk_m = 52 / 12
    receipts_mo = n * trips_per_user_wk * A["receipts_filed_per_trip"] * wk_m
    photos_mo = photos_wk * wk_m
    asks_mo = n * A["ask_per_month"]
    usd_models = receipts_mo * A["usd_receipt_decode"] + photos_mo * A["usd_photo_check"] + asks_mo * A["usd_ask"]
    # infrastructure bill, per month (A prices)
    usd_compute = procs * A["usd_per_core_month"]
    usd_db = user_data_gb * A["usd_per_gb_db_month"]
    usd_obj = (kept * A["photo_mb"] / 1000) * A["usd_per_gb_obj_month"]
    pg_conns = procs * A["pg_conn_per_process"]
    limits = [
        {"id": "cpu", "name": "API processes (Python, one core each)",
         "value": f"{peak_rps:,.0f} req/s at the peak minute; {procs:,} process{'es' if procs != 1 else ''} at {usable_rps:,.0f} req/s each",
         "ratio": peak_rps / usable_rps, "kind": "M+A",
         "fix": "More processes behind a load balancer (stateless, so it is cheap); cache the derived list per household."},
        {"id": "imgfile", "name": "Store map photos (one shared JSON file)",
         "value": f"{img_mb:,.0f} MB file, rewritten whole for each new photo: {ingest_ms / 1000:,.1f} s per photo, so at most {photo_ceiling_s:,.1f} photos/s; the peak needs {photo_peak_s:,.2f}",
         "ratio": max(ingest_ms / 1000.0, photo_peak_s / photo_ceiling_s), "kind": "M+A",
         "fix": "Photos to object storage, map rows to Postgres, one row per segment (already planned in api/pgstore.py)."},
        {"id": "sessions", "name": "Sign-in sessions (one file read per request)",
         "value": f"{sess_mb:,.1f} MB read on every request: {sess_ms:,.0f} ms each",
         "ratio": sess_ms / 100.0, "kind": "M+A",
         "fix": "Sessions in Postgres or Redis with an indexed lookup; sign cookies so most requests skip the lookup."},
        {"id": "derive", "name": "Today screen recomputed on every read",
         "value": f"{home_ms_1y:,.0f} ms of CPU per household after a year of receipts; {n * A['opens_per_week'] * home_ms_1y / 1000 / 3600 / 24 / 7 * 24:,.1f} core-hours a day",
         "ratio": home_ms_1y / 400.0, "kind": "M+A",
         "fix": "Cache the derived state per household and invalidate on a new receipt; recompute in the background."},
        {"id": "pgconn", "name": "Postgres connections (pooler)",
         "value": f"{pg_conns:,} connections wanted; plan allows {A['pg_conn_limit']}",
         "ratio": pg_conns / A["pg_conn_limit"], "kind": "A",
         "fix": "Transaction-mode pooler, fewer threads per process, read replicas for community aggregates."},
        {"id": "presence", "name": "Arya Shoppers presence (not built)",
         "value": f"{conc:,.0f} shoppers in a store at the peak; {pres_wps:,.0f} presence writes/s",
         "ratio": pres_wps / 2000.0, "kind": "A",
         "fix": "Keep presence in memory or Redis, not Postgres; publish one count per store per minute."},
    ]
    for l in limits:
        r = l["ratio"]
        l["status"] = "ok" if r < 0.5 else ("strained" if r < 1.0 else "breaks")
    total = usd_models + usd_compute + usd_db + usd_obj
    return {
        "users": n, "households": round(hh), "neighborhoods": max(1, round(n / d)), "stores": stores,
        "density": d, "peak_rps": round(peak_rps, 1), "processes": procs,
        "requests_per_week": round(reqs_wk),
        "data": {"user_data_gb_1y": round(user_data_gb, 2), "docs": docs, "receipts_doc_kb_1y": round(receipts_doc_kb_1y),
                 "receipt_lines_per_week": round(n * lines_per_user_wk), "photos_per_week": round(photos_wk),
                 "map_image_mb": round(img_mb, 1), "photo_gb_object_store": round(kept * A["photo_mb"] / 1000, 2)},
        "limits": limits,
        "cost": {"models": round(usd_models), "compute": round(usd_compute), "database": round(usd_db),
                 "photos": round(usd_obj), "total": round(total),
                 "per_user": round(total / n, 3),
                 "models_per_user": round(usd_models / n, 3),
                 "receipts_mo": round(receipts_mo), "photos_mo": round(photos_mo), "asks_mo": round(asks_mo)},
    }
