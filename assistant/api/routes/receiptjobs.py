"""Background receipt reading (api/receiptjobs.py): open a batch, send
each picture or PDF, commit, and the server reads them while the app is
closed."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import receiptjobs
from api.deps import _json_obj

router = APIRouter()

_MEDIA = ("application/pdf",)


@router.post("/api/receipts/jobs")
async def receipt_job_create(req: Request):
    """Open a batch: {count}."""
    body = await _json_obj(req)
    try:
        return receiptjobs.create(body.get("count"))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/api/receipts/jobs/{job_id}/files/{n}")
async def receipt_job_file(job_id: str, n: int, req: Request):
    """One picture or PDF of a batch. Sending it again replaces it."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not (media.startswith("image/") or media in _MEDIA):
        raise HTTPException(415, "send a receipt photo (image) or a PDF")
    name = req.headers.get("x-file-name") or ""
    body = await req.body()
    try:
        return await run_in_threadpool(receiptjobs.put_file, job_id, n, body, media, name)
    except KeyError:
        raise HTTPException(404, "no such batch")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/receipts/jobs/{job_id}/commit")
async def receipt_job_commit(job_id: str):
    """Every file is up: read the batch in the background."""
    try:
        return await run_in_threadpool(receiptjobs.commit, job_id)
    except KeyError:
        raise HTTPException(404, "no such batch")


@router.get("/api/receipts/jobs")
def receipt_jobs():
    """This account's recent batches, newest first."""
    return {"jobs": receiptjobs.jobs()}


@router.post("/api/receipts/jobs/{job_id}/resume")
async def receipt_job_resume(job_id: str):
    """Carry on a paused batch (after Unfreeze or a new day)."""
    try:
        return await run_in_threadpool(receiptjobs.resume_job, job_id)
    except KeyError:
        raise HTTPException(404, "no such batch")


@router.post("/api/receipts/jobs/{job_id}/seen")
def receipt_job_seen(job_id: str):
    try:
        return receiptjobs.mark_seen(job_id)
    except KeyError:
        raise HTTPException(404, "no such batch")
