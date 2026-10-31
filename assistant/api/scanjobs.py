"""Background store scans (owner, 2026-10-30): "It should do all of it
that it wants in the background and then give me notification later."

The phone grades frames while the shopper walks and keeps the sharp
ones on the phone (IndexedDB) until there is signal. Then it opens a
job, sends the frames one by one (a weak signal only resends one
frame), and commits. Here every frame goes through the same steps as
the live scan, in the same privacy order (storescan.read_and_keep:
people scrubbed first and fail closed, then the read, then the map),
and the job keeps what was found for the "Your map is ready" card.

Storage: the job list is the account's own store (scan_jobs.json).
Raw frames wait on disk under the account's folder and are deleted as
soon as they are read; only blurred frames that make a section's best
few stay, on the shared map, exactly as before. A demo visitor's frames
stay in memory, with the rest of the visit.

One worker thread reads committed jobs, a few frames at a time. The
server restarts on every deploy, so committed jobs are listed in the
data root (scan_jobs_pending.json) and picked up again at start.
ARYA_SCAN_JOBS_INLINE=1 reads a job inside the commit call (tests).
"""
import contextvars, json, logging, os, queue, shutil, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from api import state

log = logging.getLogger("arya.scanjobs")

JOBS_FILE = "scan_jobs.json"
PENDING_FILE = "scan_jobs_pending.json"
MAX_FRAMES = 40            # frames read per walk (cost cap, owner plan 2026-10-30)
KEEP_JOBS = 10             # finished jobs kept per account
STALE_UPLOAD_DAYS = 3      # an upload never committed is dropped after this
READERS = 3                # frames read at once within a job
MAX_FRAME_BYTES = 12_000_000

_queue = queue.Queue()
_worker = None
_worker_lock = threading.Lock()
_mem = {}                  # job id -> {n: bytes}, demo visits only
_job_locks = {}


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _lock(job_id):
    with _worker_lock:
        return _job_locks.setdefault(job_id, threading.Lock())


# --- the account's job list ------------------------------------------------

def _load():
    return state._load(JOBS_FILE, {"jobs": []})


def _save(doc):
    state._save(JOBS_FILE, doc)


def _find(doc, job_id):
    for j in doc["jobs"]:
        if j["id"] == job_id:
            return j
    raise KeyError(job_id)


def _update(job_id, fn):
    with state.file_lock(JOBS_FILE):
        doc = _load()
        job = _find(doc, job_id)
        fn(job)
        _save(doc)
        return dict(job)


def public(job):
    return {k: job.get(k) for k in ("id", "store", "source", "status", "total",
                                    "done", "result", "seen", "at", "error")} | {
        "received": len(job.get("received") or [])}


def jobs(store=None):
    doc = _load()
    out = [public(j) for j in doc["jobs"]
           if store is None or j["store"] == store]
    return sorted(out, key=lambda j: j["at"], reverse=True)


def _prune(doc):
    """Keep the newest finished jobs and drop uploads nobody committed."""
    now = datetime.now()
    keep, done = [], 0
    for j in sorted(doc["jobs"], key=lambda j: j["at"], reverse=True):
        age = (now - datetime.fromisoformat(j["at"])).days
        if j["status"] == "uploading" and age >= STALE_UPLOAD_DAYS:
            _drop_frames(j["id"])
            continue
        if j["status"] in ("ready", "failed"):
            done += 1
            if done > KEEP_JOBS:
                continue
        keep.append(j)
    doc["jobs"] = keep


# --- frames ------------------------------------------------------------------

def _frame_dir(job_id):
    return os.path.join(state.data_dir(), "scan-frames", job_id)


def put_frame(job_id, n, body):
    """Keep one frame until the job reads it. Sending the same frame
    again (a retry after a dropped connection) just replaces it."""
    if not body:
        raise ValueError("empty upload")
    if len(body) > MAX_FRAME_BYTES:
        raise ValueError("photo too large (12 MB max)")
    doc = _load()
    job = _find(doc, job_id)
    if job["status"] != "uploading":
        raise ValueError("this walk was already sent")
    if not (0 <= n < job["total"]):
        raise ValueError("frame number out of range")
    if state.in_sandbox():
        _mem.setdefault(job_id, {})[n] = body
    else:
        d = _frame_dir(job_id)
        os.makedirs(d, exist_ok=True)
        tmp = os.path.join(d, f".{n:03d}.tmp")
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, os.path.join(d, f"{n:03d}.jpg"))

    def add(j):
        got = set(j.get("received") or [])
        got.add(n)
        j["received"] = sorted(got)
    return public(_update(job_id, add))


def _read_frame(job_id, n):
    if job_id in _mem:
        return _mem[job_id].get(n)
    try:
        with open(os.path.join(_frame_dir(job_id), f"{n:03d}.jpg"), "rb") as fh:
            return fh.read()
    except OSError:
        return None


def _forget_frame(job_id, n):
    if job_id in _mem:
        _mem[job_id].pop(n, None)
        return
    try:
        os.remove(os.path.join(_frame_dir(job_id), f"{n:03d}.jpg"))
    except OSError:
        pass


def _drop_frames(job_id):
    _mem.pop(job_id, None)
    shutil.rmtree(_frame_dir(job_id), ignore_errors=True)


# --- opening and committing a job ---------------------------------------------

def create(store, frames, source="scan", prices=False):
    """Open a job for a walk of `frames` frames. Returns the job; its
    `total` may be lower than asked (MAX_FRAMES, or what is left of the
    day's frame cap), and the phone sends only that many."""
    from api import storescan
    if source not in ("scan", "upload"):
        raise ValueError("source must be scan or upload")
    try:
        frames = int(frames)
    except (TypeError, ValueError):
        raise ValueError("frames must be a number")
    if frames < 1:
        raise ValueError("a walk needs at least one frame")
    left = storescan.frames_left()
    if left <= 0:
        raise OverflowError("You've mapped a lot today. Thank you! "
                            "Scanning opens again tomorrow.")
    job = {"id": uuid.uuid4().hex[:16], "store": store, "source": source,
           "prices": bool(prices), "total": min(frames, MAX_FRAMES, left),
           "received": [], "done": 0, "status": "uploading", "result": None,
           "seen": False, "at": _now(), "error": None}
    with state.file_lock(JOBS_FILE):
        doc = _load()
        _prune(doc)
        doc["jobs"].append(job)
        _save(doc)
    return public(job)


def commit(job_id):
    """The phone sent what it had: read the frames in the background.
    A frame that never arrived is simply not read."""
    def go(j):
        if j["status"] != "uploading":
            return
        j["status"] = "queued"
        j["total"] = len(j.get("received") or [])
    job = _update(job_id, go)
    if job["status"] != "queued":
        return public(job)
    if not job["total"]:
        _finish(job_id, error=None)
        return public(_find(_load(), job_id))
    ctx = contextvars.copy_context()
    # The job outlives this request: it must not read the request's memo.
    ctx.run(state._memo.set, None)
    user, group = state._current_user.get(), state.current_group()
    if not state.in_sandbox():
        _pending_add(user, group, job_id)
    if os.environ.get("ARYA_SCAN_JOBS_INLINE") == "1":
        ctx.run(_run, job_id)
    else:
        _queue.put((ctx, job_id))
        _ensure_worker()
    return public(_find(_load(), job_id))


def mark_seen(job_id):
    return public(_update(job_id, lambda j: j.__setitem__("seen", True)))


# --- the worker -----------------------------------------------------------------

def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name="arya-scanjobs",
                                       daemon=True)
            _worker.start()


def _loop():
    while True:
        ctx, job_id = _queue.get()
        try:
            ctx.run(_run, job_id)
        except Exception:
            log.exception("scan job %s failed", job_id)
        finally:
            _queue.task_done()


def _empty_result():
    return {"found": [], "signs": [], "prices": [], "people": 0,
            "skipped": 0, "pts": 0, "title": None, "capped": False}


def _run(job_id):
    """Read every frame of one job, a few at a time, then mark it
    ready. Runs inside the account's context (user, group, demo
    overlay), copied when the job was committed."""
    from api import storescan
    from api.deps import new_client
    with _lock(job_id):
        try:
            job = _update(job_id, lambda j: j.__setitem__("status", "reading"))
        except KeyError:
            return
        result = job.get("result") or _empty_result()
        res_lock = threading.Lock()
        frames = list(job.get("received") or [])
        if not os.environ.get("MODEL_API_KEY"):
            _finish(job_id, error="Shelf reading isn't on right now, so "
                                  "this walk could not be read.")
            return

        def one(n):
            body = _read_frame(job_id, n)
            if body is None:
                return
            with res_lock:
                if result["capped"] or storescan.frames_left() <= 0:
                    result["capped"] = True
                    _forget_frame(job_id, n)
                    return
                storescan.count_frame()
            try:
                out = storescan.read_and_keep(job["store"], body, new_client(),
                                              "image/jpeg", job["prices"],
                                              outlines=False)
            except Exception as e:      # scrub failed, map refused, model error
                log.info("scan job %s frame %s skipped: %s", job_id, n, e)
                out = {"kept": False}
            finally:
                _forget_frame(job_id, n)
            with res_lock:
                _merge(result, out)
                snap = json.loads(json.dumps(result))

            def step(j):
                j["done"] = int(j.get("done") or 0) + 1
                j["result"] = snap
            _update(job_id, step)

        if os.environ.get("ARYA_SCAN_JOBS_INLINE") == "1":
            for n in frames:
                one(n)
        else:
            with ThreadPoolExecutor(READERS) as pool:
                for n in frames:
                    pool.submit(contextvars.copy_context().run, one, n)
        _finish(job_id, error=None, result=result)


def _merge(result, out):
    """Fold one frame's answer into the job's summary: the sections
    found (each once), signs, prices, people blurred, frames skipped,
    points and a new title."""
    if not out.get("kept") or not out.get("segment"):
        result["skipped"] += 1
        return
    found = {f["segment"]: f for f in result["found"]}
    cur = found.get(out["segment"]) or {"segment": out["segment"], "label": out["label"],
                                        "created": bool(out.get("created")), "fresh": False}
    rw = out.get("reward") or {}
    if rw:
        result["pts"] += int(rw.get("points") or 0)
        if rw.get("new_section"):
            cur["fresh"] = True
        if rw.get("new_title"):
            result["title"] = rw["new_title"]
    if out.get("created"):
        cur["created"] = True
    found[out["segment"]] = cur
    result["found"] = list(found.values())
    if out.get("sign") and out["sign"] not in result["signs"]:
        result["signs"].append(out["sign"])
    result["prices"].extend(out.get("prices") or [])
    result["people"] += int(out.get("people") or 0)


def _finish(job_id, error=None, result=None):
    def done(j):
        j["status"] = "failed" if error else "ready"
        j["error"] = error
        if result is not None:
            j["result"] = result
        elif j.get("result") is None:
            j["result"] = _empty_result()
    try:
        _update(job_id, done)
    except KeyError:
        pass
    _drop_frames(job_id)
    _pending_remove(job_id)


# --- surviving a restart ----------------------------------------------------------

def _pending_path():
    return os.path.join(state.base_dir(), PENDING_FILE)


def _pending_read():
    try:
        with open(_pending_path()) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def _pending_add(user, group, job_id):
    path = _pending_path()
    with state.lock_for(path):
        rows = [r for r in _pending_read() if r.get("id") != job_id]
        rows.append({"user": user, "group": group, "id": job_id})
        state.write_json_atomic(path, rows)


def _pending_remove(job_id):
    path = _pending_path()
    with state.lock_for(path):
        rows = _pending_read()
        if any(r.get("id") == job_id for r in rows):
            state.write_json_atomic(path, [r for r in rows if r.get("id") != job_id])


def resume():
    """At start: queue every committed job a restart interrupted. The
    frames already read were deleted, so a job only reads the rest."""
    rows = _pending_read()
    for r in rows:
        def requeue(r=r):
            with state.as_user(r.get("user"), r.get("group")):
                try:
                    job = _find(_load(), r["id"])
                except KeyError:
                    _pending_remove(r["id"])
                    return None
                if job["status"] not in ("queued", "reading"):
                    _pending_remove(r["id"])
                    return None
                return contextvars.copy_context()
        ctx = requeue()
        if ctx is not None:
            _queue.put((ctx, r["id"]))
    if rows:
        _ensure_worker()
    return len(rows)
