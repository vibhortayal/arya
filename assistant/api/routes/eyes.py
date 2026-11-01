"""Arya's eyes: pantry and shelf photos kept as sightings."""
import hashlib
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import own_key
from api import state
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


@router.post("/eyes/photo")
async def eyes_photo(req: Request, kind: str = "fridge"):
    if kind not in ("fridge", "pantry", "freezer", "fruit"):
        raise HTTPException(400, "kind must be fridge, pantry, freezer, or fruit")
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo of the fridge, pantry, freezer, or fruit")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    own_key.need_model()
    _budget_guard()
    from api.eyes.service import detect, match_item
    from datetime import date as _d
    client = new_client()
    try:
        sightings = await run_in_threadpool(detect, body, client,
                                            media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    rec_id = "eye-" + hashlib.sha1(body).hexdigest()[:10]
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(media, ".jpg")
    photo_dir = os.path.join(state.data_dir(), "eyes_photos")
    os.makedirs(photo_dir, exist_ok=True)
    with open(os.path.join(photo_dir, rec_id + ext), "wb") as fh:
        fh.write(body)
    idx = state.name_index()
    for sg in sightings:
        sg["item_id"] = match_item(sg["name"], idx)
        sg["state"] = "pending"
    rec = {"id": rec_id, "date": _d.today().isoformat(), "kind": kind,
           "photo": rec_id + ext, "sightings": sightings}
    state.save_eyes_record(rec)
    return rec


@router.get("/api/eyes")
def eyes_list():
    return {"records": sorted(state.eyes_records(), key=lambda r: r["date"], reverse=True)}


@router.post("/api/eyes/{rec_id}/delete")
def eyes_delete(rec_id: str):
    """Delete one Eyes photo and its record (Tranche 1)."""
    from api import state
    if state.delete_eyes_record(rec_id) is None:
        raise HTTPException(404, "no such photo")
    return {"ok": True, "deleted": rec_id}


@router.get("/eyes/photos/{rec_id}")
def eyes_photo_file(rec_id: str):
    from fastapi.responses import FileResponse
    photo_dir = os.path.join(state.data_dir(), "eyes_photos")
    for ext in (".jpg", ".png", ".webp"):
        p = os.path.join(photo_dir, rec_id + ext)
        if os.path.exists(p):
            return FileResponse(p)
    raise HTTPException(404, "no such photo")


@router.post("/api/eyes/{rec_id}/sightings/{idx}")
async def eyes_decide(rec_id: str, idx: int, req: Request):
    body = await _json_obj(req)
    decision = body.get("state")
    if decision not in ("confirmed", "rejected"):
        raise HTTPException(400, "state must be confirmed or rejected")
    for rec in state.eyes_records():
        if rec["id"] == rec_id:
            if idx < 0 or idx >= len(rec["sightings"]):
                raise HTTPException(404, "no such sighting")
            rec["sightings"][idx]["state"] = decision
            state.save_eyes_record(rec)
            return rec
    raise HTTPException(404, "no such eyes record")
