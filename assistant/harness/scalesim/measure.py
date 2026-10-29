"""Measure the REAL Arya API and store map with simulated households.

Writes N synthetic households (the real on-disk layout) into a throw-away
data folder, starts the real API on it, and times it. Nothing touches the
production data folder: pass --root to choose the throw-away folder; the
default is a fresh temp folder that is deleted afterwards.

  python -m harness.scalesim.measure --users 1000 --out harness/scalesim/calibration.json

Only measures what the code does today: file-backed store (ARYA_STORE=json),
one uvicorn process, no model calls. Postgres is NOT measured here.
"""
import argparse
import concurrent.futures as cf
import io
import json
import os
import random
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from datetime import timedelta

from . import world as W


def _pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else None


def write_households(root, users, weeks, seed=W.SEED):
    """Run the agent sim and write every household in the real file layout."""
    from . import agents
    raw = {}
    agents.run(users, weeks=weeks, seed=seed, raw=raw)
    item = {it[0]: it for it in W.ITEMS}
    by_hh = {}
    for (wk, day, h, s, i, p) in raw["purchases"]:
        by_hh.setdefault(h, {}).setdefault((s, day), []).append((i, p))
    names, tokens = [], {}
    udir = os.path.join(root, "users")
    n_files = total_bytes = 0
    for h in raw["households"]:
        for m in range(len(h["members"])):
            pass
        user = f"sim{h['id']:05d}"
        names.append(user)
        d = os.path.join(udir, user)
        os.makedirs(d, exist_ok=True)
        receipts, used = [], set()
        for k, ((store, day), lines) in enumerate(sorted(by_hh.get(h["id"], {}).items(), key=lambda kv: kv[0][1])):
            ls = []
            for (iid, p) in lines:
                used.add(iid)
                nm = item[iid][1]
                ls.append({"raw": nm.upper(), "detail": None, "sku": f"sim-{iid}", "decoded_name": nm,
                           "qty": 1, "unit_price": p, "line_total": p, "line_type": "item",
                           "discount_parent_sku": None, "confidence": 1.0, "status": "auto",
                           "allocation": "HOUSEHOLD", "for_person": None, "item_id": f"sim-{iid}",
                           "judge_agree": None})
            sub = round(sum(l["line_total"] for l in ls), 2)
            receipts.append({"receipt_id": f"{user}-r{k:03d}", "source_type": "grocery", "merchant": store,
                             "purchased_at": (agents.EPOCH + timedelta(days=day)).date().isoformat(),
                             "lines": ls, "subtotal": sub, "tax": 0.0, "total": sub,
                             "totals_reconcile": True, "image_ref": None})
        dictionary = {"version": 1, "entries": [
            {"item_id": f"sim-{i}", "sku": f"sim-{i}", "canonical_name": item[i][1], "kind": "product",
             "category": None, "aliases": [], "spoken_names": [], "typical_unit": None, "sam_concept": None,
             "detail_variants": [], "purchase_count": 0, "median_price": item[i][3], "first_seen": None,
             "last_seen": None, "resolution": {"status": "auto", "confidence": None, "candidates": []}}
            for i in sorted(used)]}
        judged = {f"sim-{i}": {"class": "STAPLE", "list_ok": True, "reason": "simulated", "buys": 4} for i in used}
        for name, obj in (("receipts.json", receipts), ("dictionary.json", dictionary), ("judged.json", judged),
                          ("lists.json", {"lists": []}), ("flags.json", {})):
            p = os.path.join(d, name)
            with open(p, "w") as f:
                json.dump(obj, f)
            n_files += 1
            total_bytes += os.path.getsize(p)
    return names, {"households": len(names), "files": n_files, "bytes": total_bytes,
                   "receipts": sum(len(v) for v in by_hh.values()), "lines": len(raw["purchases"])}


def write_auth(root, names):
    """users.json + sessions.json written directly (hashing 1,000 passwords is not the thing under test)."""
    import hashlib
    users = {n: {"salt": "00", "hash": "00", "created": int(time.time())} for n in names}
    sessions, tokens = {}, {}
    for n in names:
        tok = f"simtoken-{n}"
        tokens[n] = tok
        sessions[hashlib.sha256(tok.encode()).hexdigest()] = {"user": n, "demo": False, "expires": int(time.time()) + 86400}
    json.dump(users, open(os.path.join(root, "users.json"), "w"))
    return tokens, sessions


def start_api(root, port):
    env = dict(os.environ, ARYA_DATA_DIR=root, ARYA_INSECURE_COOKIE="1", ARYA_STORE="json",
               MODEL_API_KEY="", ARYA_GROUPS="0")
    here = os.path.join(os.path.dirname(__file__), "..", "..")
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "api.main:app", "--port", str(port), "--log-level", "warning"],
                         cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    import httpx
    for _ in range(100):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=1).status_code < 500:
                break
        except Exception:
            time.sleep(0.2)
    return p


def rss_mb(pid):
    try:
        for line in open(f"/proc/{pid}/status"):
            if line.startswith("VmRSS"):
                return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        return None


def load_test(port, pid, names, tokens, seconds=12, levels=(1, 8, 32, 96)):
    import httpx
    from api import auth
    paths = ["/api/home", "/api/lists", "/api/prices/insights", "/api/powers"]
    out = {"levels": [], "per_endpoint": {}}
    clients = {n: httpx.Client(base_url=f"http://127.0.0.1:{port}", cookies={auth.COOKIE: tokens[n]}, timeout=60) for n in names}
    # one cold pass: every user opens the app once
    lat = {p: [] for p in paths}
    errs = 0
    t0 = time.time()
    def first(n):
        nonlocal errs
        res = []
        for p in paths:
            t = time.time()
            r = clients[n].get(p)
            res.append((p, (time.time() - t) * 1000, r.status_code))
        return res
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(first, names):
            for p, ms, code in res:
                lat[p].append(ms)
                errs += code != 200
    wall = time.time() - t0
    out["open_app_all_users"] = {"users": len(names), "seconds": round(wall, 1), "errors": errs,
                                 "users_per_second": round(len(names) / wall, 1)}
    out["per_endpoint"] = {p: {"p50_ms": round(_pct(v, .5), 1), "p95_ms": round(_pct(v, .95), 1),
                               "p99_ms": round(_pct(v, .99), 1)} for p, v in lat.items()}
    out["rss_mb_after_cold"] = rss_mb(pid)
    for conc in levels:
        stop = time.time() + seconds
        lats, errs, count = [], 0, 0
        lock = threading.Lock()
        def worker(seed):
            nonlocal errs, count
            rng = random.Random(seed)
            while time.time() < stop:
                n = rng.choice(names)
                p = rng.choice(paths)
                t = time.time()
                try:
                    r = clients[n].get(p)
                    code = r.status_code
                except Exception:
                    code = 599
                ms = (time.time() - t) * 1000
                with lock:
                    lats.append(ms)
                    count += 1
                    errs += code != 200
        ths = [threading.Thread(target=worker, args=(i,)) for i in range(conc)]
        [t.start() for t in ths]
        [t.join() for t in ths]
        out["levels"].append({"concurrency": conc, "rps": round(count / seconds, 1), "p50_ms": round(_pct(lats, .5), 1),
                              "p95_ms": round(_pct(lats, .95), 1), "p99_ms": round(_pct(lats, .99), 1),
                              "errors": errs, "rss_mb": rss_mb(pid)})
    return out


def storemap_bench(captures=600, threads=8):
    """The shared store map is ONE file under ONE lock. Time real ingests as it fills."""
    import numpy as np
    from PIL import Image
    d = tempfile.mkdtemp(prefix="scalesim-map-")
    os.environ["ARYA_DATA_DIR"] = d
    from api import storemap
    segs = []
    for z in range(30):
        storemap.add_segment("Simulated Mart", f"Aisle {z + 1}", "both")
        segs.append(f"aisle-{z + 1}:both")
    rng = np.random.default_rng(7)

    def jpeg(i):
        a = (rng.random((480, 640, 3)) * 255).astype("uint8")
        a[:, ::7] = 255 - a[:, ::7]
        b = io.BytesIO()
        Image.fromarray(a).save(b, "JPEG", quality=70)
        return b.getvalue()
    pics = [jpeg(i) for i in range(12)]
    res = {"jpeg_kb": round(sum(map(len, pics)) / len(pics) / 1024, 1)}
    # sequential: latency as the map fills
    t_seq = []
    for i in range(min(captures, 150)):
        t = time.time()
        storemap.ingest("Simulated Mart", segs[i % 30], pics[i % 12])
        t_seq.append((time.time() - t) * 1000)
    res["ingest_ms_first_30"] = round(statistics.median(t_seq[:30]), 1)
    res["ingest_ms_last_30"] = round(statistics.median(t_seq[-30:]), 1)
    # concurrent: lock contention
    def one(i):
        t = time.time()
        storemap.ingest("Simulated Mart", segs[i % 30], pics[(i * 5) % 12])
        return (time.time() - t) * 1000
    t0 = time.time()
    with cf.ThreadPoolExecutor(threads) as ex:
        lat = list(ex.map(one, range(120)))
    wall = time.time() - t0
    res["concurrent"] = {"threads": threads, "captures_per_second": round(120 / wall, 1),
                         "p50_ms": round(_pct(lat, .5), 1), "p95_ms": round(_pct(lat, .95), 1)}
    sizes = {n: os.path.getsize(os.path.join(d, n)) for n in ("storemap.json", "storemap_img.json") if os.path.exists(os.path.join(d, n))}
    res["bytes_one_store_30_segments"] = sizes
    res["view_ms"] = round(min((lambda t: (storemap.view("Simulated Mart"), (time.time() - t) * 1000)[1])(time.time()) for _ in range(5)), 1)
    shutil.rmtree(d, ignore_errors=True)
    return res


def per_user_cost(root, names, tokens, port):
    import httpx
    from api import auth
    t = []
    for n in names[:60]:
        c = httpx.Client(base_url=f"http://127.0.0.1:{port}", cookies={auth.COOKIE: tokens[n]}, timeout=60)
        s = time.time()
        c.get("/api/home")
        t.append((time.time() - s) * 1000)
    return round(statistics.median(t), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=1000)
    ap.add_argument("--weeks", type=int, default=12)
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--seconds", type=int, default=12)
    ap.add_argument("--out", default=None)
    ap.add_argument("--root", default=None, help="throw-away data folder (default: new temp folder)")
    a = ap.parse_args()
    root = a.root or tempfile.mkdtemp(prefix="scalesim-data-")
    if os.path.abspath(root) == os.path.abspath(os.environ.get("ARYA_DATA_DIR", "data")):
        sys.exit("refusing to write into the live data folder")
    os.environ["ARYA_DATA_DIR"] = root
    result = {"label": "Measured on simulated households, one uvicorn process, file-backed store",
              "users": a.users, "weeks": a.weeks, "cpu_count": os.cpu_count()}
    t = time.time()
    names, disk = write_households(root, a.users, a.weeks)
    tokens, sessions = write_auth(root, names)
    json.dump(sessions, open(os.path.join(root, "sessions.json"), "w"))
    result["disk"] = dict(disk, write_seconds=round(time.time() - t, 1),
                          bytes_per_household=round(disk["bytes"] / disk["households"]),
                          sessions_json_kb=round(os.path.getsize(os.path.join(root, "sessions.json")) / 1024, 1))
    proc = start_api(root, a.port)
    try:
        result["api"] = load_test(a.port, proc.pid, names, tokens, seconds=a.seconds)
        result["api"]["home_ms_per_household_median"] = per_user_cost(root, names, tokens, a.port)
    finally:
        proc.terminate()
    result["storemap"] = storemap_bench()
    if not a.root:
        shutil.rmtree(root, ignore_errors=True)
    out = json.dumps(result, indent=1)
    if a.out:
        open(a.out, "w").write(out)
    print(out)


if __name__ == "__main__":
    main()
