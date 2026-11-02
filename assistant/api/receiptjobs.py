"""Background receipt reading (owner, 2026-11-01): "I want background."

The phone sends the pictures and PDFs up first (quick, free), then the
server reads them one after another while the app is closed. Same
pattern as the store scans (api/scanjobs.py): a job list in the
account's own store (receipt_jobs.json), the raw files waiting on disk
until they are read, one worker thread, and committed jobs listed in the
data root (receipt_jobs_pending.json) so a deploy restart picks them up.

Every file goes through the same steps as POST /decode/photo and
/decode/pdf: budget guard (daily budget, pause switch, the account's
hourly and monthly limits), read, date check, duplicate check, store
lookup, save. A refusal that every file would hit (reading paused,
budget spent, account limit) pauses the job with the reason instead of
failing each file; resume_job continues it.
ARYA_RECEIPT_JOBS_INLINE=1 reads a job inside the commit call (tests).
"""
import contextvars, json, logging, os, queue, shutil, threading, uuid
from datetime import datetime

from api.errors import safe_detail
from fastapi import HTTPException

from api import own_key
from api import state

log = logging.getLogger("arya.receiptjobs")

JOBS_FILE = "receipt_jobs.json"
PENDING_FILE = "receipt_jobs_pending.json"
MAX_FILES = 150
KEEP_JOBS = 10
STALE_UPLOAD_DAYS = 3
MAX_PHOTO = 12_000_000
MAX_PDF = 10_000_000
SYSTEMIC = (401, 402, 429, 503)  # 402: an own-key account with no usable key

_queue = queue.Queue()
_worker = None
_worker_lock = threading.Lock()
_job_locks = {}


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _lock(job_id):
    with _worker_lock:
        return _job_locks.setdefault(job_id, threading.Lock())


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
        return json.loads(json.dumps(job))


def public(job):
    files = job.get("files") or {}
    counts = {"filed": 0, "duplicate": 0, "failed": 0}
    for f in files.values():
        if f.get("status") in counts:
            counts[f["status"]] += 1
    bad = [{"name": f.get("name"), "reason": f.get("reason")}
           for _n, f in sorted(files.items(), key=lambda kv: int(kv[0]))
           if f.get("status") == "failed"]
    return {"id": job["id"], "status": job["status"], "total": job["total"],
            "received": len(files), "done": sum(counts.values()),
            "filed": counts["filed"], "duplicate": counts["duplicate"],
            "failed": counts["failed"], "failures": bad[:20],
            "reason": job.get("reason"), "seen": job.get("seen", False),
            "at": job["at"]}


def jobs():
    doc = _load()
    return sorted((public(j) for j in doc["jobs"]), key=lambda j: j["at"], reverse=True)


def _prune(doc):
    now = datetime.now()
    keep, done = [], 0
    for j in sorted(doc["jobs"], key=lambda j: j["at"], reverse=True):
        age = (now - datetime.fromisoformat(j["at"])).days
        if j["status"] == "uploading" and age >= STALE_UPLOAD_DAYS:
            _drop_files(j["id"])
            continue
        if j["status"] in ("ready", "failed"):
            done += 1
            if done > KEEP_JOBS:
                continue
        keep.append(j)
    doc["jobs"] = keep


def _dir(job_id):
    return os.path.join(state.data_dir(), "receipt-jobs", job_id)


def _drop_files(job_id):
    shutil.rmtree(_dir(job_id), ignore_errors=True)


def create(count):
    if state.in_sandbox():
        raise PermissionError("the demo household files nothing")
    try:
        count = int(count)
    except (TypeError, ValueError):
        raise ValueError("count must be a number")
    if count < 1:
        raise ValueError("add at least one receipt")
    if count > MAX_FILES:
        raise ValueError(f"{MAX_FILES} receipts at a time at most; add the rest in another batch")
    job = {"id": uuid.uuid4().hex[:16], "total": count, "files": {},
           "status": "uploading", "reason": None, "seen": False, "at": _now()}
    with state.file_lock(JOBS_FILE):
        doc = _load()
        _prune(doc)
        doc["jobs"].append(job)
        _save(doc)
    return public(job)


def put_file(job_id, n, body, media, name):
    """One picture or PDF. Sending it again (a retry) replaces it."""
    pdf = media == "application/pdf"
    if not body:
        raise ValueError("empty upload")
    if len(body) > (MAX_PDF if pdf else MAX_PHOTO):
        raise ValueError("PDF too large (10 MB max)" if pdf else "photo too large (12 MB max)")
    doc = _load()
    job = _find(doc, job_id)
    if job["status"] != "uploading":
        raise ValueError("this batch was already sent")
    if not (0 <= n < job["total"]):
        raise ValueError("file number out of range")
    d = _dir(job_id)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, f".{n:03d}.tmp")
    with open(tmp, "wb") as fh:
        fh.write(body)
    os.replace(tmp, os.path.join(d, f"{n:03d}.bin"))

    def add(j):
        j["files"][str(n)] = {"name": (name or f"receipt {n + 1}")[:120], "media": media,
                              "status": "waiting", "reason": None}
    return public(_update(job_id, add))


def commit(job_id):
    """Every file is up: read them in the background. A file that never
    arrived is not read."""
    def go(j):
        if j["status"] != "uploading":
            return
        j["status"] = "queued"
        j["total"] = len(j["files"])
    job = _update(job_id, go)
    if job["status"] != "queued":
        return public(job)
    if not job["total"]:
        _finish(job_id)
        return public(_find(_load(), job_id))
    _enqueue(job_id)
    return public(_find(_load(), job_id))


def resume_job(job_id):
    """Carry on a paused job (after Unfreeze, a raised limit, a new day)."""
    def go(j):
        if j["status"] == "paused":
            j["status"] = "queued"
            j["reason"] = None
    job = _update(job_id, go)
    if job["status"] == "queued":
        _enqueue(job_id)
    return public(_find(_load(), job_id))


def mark_seen(job_id):
    return public(_update(job_id, lambda j: j.__setitem__("seen", True)))


def _enqueue(job_id):
    ctx = contextvars.copy_context()
    ctx.run(state._memo.set, None)     # the job outlives this request
    if not state.in_sandbox():
        _pending_add(state._current_user.get(), state.current_group(), job_id)
    if os.environ.get("ARYA_RECEIPT_JOBS_INLINE") == "1":
        ctx.run(_run, job_id)
    else:
        _queue.put((ctx, job_id))
        _ensure_worker()


def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name="arya-receiptjobs", daemon=True)
            _worker.start()


def _loop():
    while True:
        ctx, job_id = _queue.get()
        try:
            ctx.run(_run, job_id)
        except Exception:
            log.exception("receipt job %s failed", job_id)
        finally:
            _queue.task_done()


# --- reading one file -----------------------------------------------------------

def file_one(body, media):
    """Read and file one picture or PDF, like /decode/photo and /decode/pdf.
    Returns "filed" or "duplicate"; raises HTTPException(status, reason)."""
    from api import stores
    from api.decode.service import decode_photo, decode_scanned_pdf, decode_text, extract_pdf_text
    from api.deps import _budget_guard, new_client
    own_key.need_model()
    _budget_guard()
    client = new_client()
    pdf = media == "application/pdf"
    try:
        if pdf:
            try:
                text = extract_pdf_text(body)
            except Exception:
                raise HTTPException(422, "could not read this PDF")
            receipt = (decode_scanned_pdf(body, client) if len(text.strip()) < 20
                       else decode_text(text, client))
        else:
            receipt = decode_photo(body, client, media_type=media)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except own_key.OwnKeyFailed as e:
        # 503 is systemic: the whole job pauses with this reason, rather
        # than every file failing one by one (BYOK review 19).
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        logging.getLogger("arya.input").warning("input failure: receipt job model error (%s)", str(e)[:120])
        raise HTTPException(502, safe_detail(e))
    if not receipt.get("purchased_at"):
        raise HTTPException(422, "could not read the date on this receipt")
    if state.find_duplicate(receipt) is not None:
        return "duplicate"
    stores.resolve_merchants([receipt.get("merchant")])
    added = state.add_receipts([receipt], media={receipt["receipt_id"]: (body, media)})
    if not added:
        return "duplicate"
    state.judge_pending(new_client())
    return "filed"


def _run(job_id):
    with _lock(job_id):
        try:
            job = _update(job_id, lambda j: j.__setitem__("status", "reading"))
        except KeyError:
            return
        for key in sorted(job["files"], key=int):
            f = job["files"][key]
            if f["status"] != "waiting":
                continue
            n = int(key)
            path = os.path.join(_dir(job_id), f"{n:03d}.bin")
            try:
                with open(path, "rb") as fh:
                    body = fh.read()
            except OSError:
                _mark(job_id, key, "failed", "the file was lost before it was read")
                continue
            try:
                outcome = file_one(body, f["media"])
            except HTTPException as e:
                if e.status_code in SYSTEMIC:
                    _update(job_id, lambda j: (j.__setitem__("status", "paused"),
                                               j.__setitem__("reason", str(e.detail))))
                    return
                _mark(job_id, key, "failed", str(e.detail))
                _forget(job_id, n)
                continue
            except Exception as e:      # never let one file stop the rest
                log.exception("receipt job %s file %s", job_id, n)
                _mark(job_id, key, "failed", "Arya could not read this one")
                _forget(job_id, n)
                continue
            _mark(job_id, key, outcome, None)
            _forget(job_id, n)
        _finish(job_id)


def _mark(job_id, key, status, reason):
    def go(j):
        j["files"][key]["status"] = status
        j["files"][key]["reason"] = reason
    _update(job_id, go)


def _forget(job_id, n):
    try:
        os.remove(os.path.join(_dir(job_id), f"{n:03d}.bin"))
    except OSError:
        pass


def _finish(job_id):
    try:
        _update(job_id, lambda j: j.__setitem__("status", "ready"))
    except KeyError:
        pass
    _drop_files(job_id)
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
    """At start: queue every committed job a restart interrupted. Files
    already read were deleted, so a job only reads the rest."""
    rows = _pending_read()
    for r in rows:
        with state.as_user(r.get("user"), r.get("group")):
            try:
                job = _find(_load(), r["id"])
            except KeyError:
                _pending_remove(r["id"])
                continue
            if job["status"] not in ("queued", "reading"):
                _pending_remove(r["id"])
                continue
            ctx = contextvars.copy_context()
        _queue.put((ctx, r["id"]))
    if rows:
        _ensure_worker()
    return len(rows)
