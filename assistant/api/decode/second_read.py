"""The demo's receipt second read (owner, 2026-11-03, "do this change in
demo only"): the visitor sees Muse Spark's read as soon as the checks
flag it, and Muse Wonder's second read lands on the same screen.

A job runs Wonder in a background thread and holds the outcome in this
process's memory only (never on disk), keyed by an unguessable id and
bound to the visitor's own sandbox. The screen polls check(); the first
poll after Wonder finishes swaps the receipt in the visitor's sandbox.

States: pending (Wonder still reading), changed (Wonder's lines or total
differ; each changed line says what Spark read), same (same names,
prices and total), failed (Wonder timed out or failed: Spark's read
stays, every line sent to review)."""
import contextvars, secrets, threading, time

from api import state

KEEP_S = 600          # a finished job is forgotten after 10 minutes
MAX_JOBS = 200
_jobs = {}            # id -> job
_lock = threading.Lock()


def _box():
    return id(state._overlay.get())


def start(spark, reasons, second):
    """Run second() in the background; return the job id."""
    jid = secrets.token_urlsafe(12)
    job = {"id": jid, "box": _box(), "spark": spark, "reasons": list(reasons),
           "state": "pending", "result": None, "applied": False, "at": time.time()}
    with _lock:
        _jobs[jid] = job
        for k in sorted(_jobs, key=lambda k: _jobs[k]["at"])[:max(0, len(_jobs) - MAX_JOBS)]:
            _jobs.pop(k, None)
    ctx = contextvars.copy_context()   # the visitor's sandbox and budget

    def run():
        try:
            rec = ctx.run(second)
        except Exception:
            rec = None
        with _lock:
            job["result"] = rec
            job["state"] = outcome(spark, rec)
            job["at"] = time.time()
    threading.Thread(target=run, daemon=True, name="demo-second-read").start()
    return jid


def _key(line):
    return ((line.get("decoded_name") or line.get("raw") or "").strip().lower(),
            line.get("line_total"))


def outcome(spark, rec):
    if rec is None or rec.get("decoded_by") == spark.get("decoded_by"):
        return "failed"
    same = ([_key(l) for l in spark.get("lines") or []] == [_key(l) for l in rec.get("lines") or []]
            and spark.get("total") == rec.get("total"))
    return "same" if same else "changed"


def marked(spark, rec):
    """Wonder's lines, each changed one carrying what Spark read
    ({"was": {"name", "price"}}, or {} for a line Spark did not have)."""
    old = spark.get("lines") or []
    out = []
    for i, l in enumerate(rec.get("lines") or []):
        l = dict(l)
        if i >= len(old):
            l["was"] = {}
        elif _key(old[i]) != _key(l):
            was = {}
            if _key(old[i])[0] != _key(l)[0]:
                was["name"] = old[i].get("decoded_name") or old[i].get("raw")
            if old[i].get("line_total") != l.get("line_total"):
                was["price"] = old[i].get("line_total")
            l["was"] = was
        out.append(l)
    return out


def _replace(rid, rec):
    """Swap the visitor's sandbox copy of the receipt for the final read."""
    with state.file_lock("receipts.json"):
        cur = state._load("receipts.json", [])
        new = [dict(rec, live=True) if r.get("receipt_id") == rid else r for r in cur]
        state._save("receipts.json", new)


def check(jid):
    """The job as the screen reads it, or None (unknown, expired, or
    another visitor's)."""
    now = time.time()
    with _lock:
        for k in [k for k, j in _jobs.items() if j["state"] != "pending" and now - j["at"] > KEEP_S]:
            _jobs.pop(k, None)
        job = _jobs.get(jid)
        if job is None or job["box"] != _box():
            return None
        st, rec, spark = job["state"], job["result"], job["spark"]
        apply = st != "pending" and rec is not None and not job["applied"]
        job["applied"] = job["applied"] or apply
    out = {"state": st, "reasons": job["reasons"]}
    if st == "pending":
        return out
    if apply:
        _replace(spark["receipt_id"], rec)
    if st == "changed":
        lines = marked(spark, rec)
        out["receipt"] = dict(rec, lines=lines)
        out["fixed"] = sum(1 for l in lines if "was" in l)
    else:
        out["receipt"] = rec or spark
    return out
