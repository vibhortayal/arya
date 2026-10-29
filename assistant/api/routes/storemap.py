"""Map my store: the guided, crowd-built store map."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from api.demo_guard import _is_demo
from api.deps import _PWA, _budget_guard, _json_obj, new_client

router = APIRouter()


# --- Map my store: the guided, crowd-built store map -----------------------
# See api/storemap.py. One shared map per store; a shopper maps the
# aisles they use, and every shopper's captures merge into it.

def _map_store(value):
    name = (value or "").strip()
    if not name:
        raise HTTPException(400, "store is required")
    return name


@router.get("/api/storemap")
def storemap_view(store: str = ""):
    from api import storemap
    name = _map_store(store)
    focus = storemap.get_focus(name)
    return {**storemap.view(name, focus=focus), "focus": focus}


@router.post("/api/storemap/segments")
async def storemap_add_segment(req: Request):
    from api import storemap
    body = await _json_obj(req)
    try:
        seg, created = storemap.add_segment(
            _map_store(body.get("store")), body.get("label"),
            body.get("side") or "both")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"segment": seg["id"], "label": seg["label"],
            "side": seg["side"], "created": created}


@router.post("/api/storemap/focus")
async def storemap_set_focus(req: Request):
    from api import storemap
    body = await _json_obj(req)
    name = _map_store(body.get("store"))
    ids = body.get("segments")
    if not isinstance(ids, list):
        raise HTTPException(400, "segments must be a list")
    return {"focus": storemap.set_focus(name, [str(i) for i in ids])}


@router.get("/api/storemap/next")
def storemap_next(store: str = "", segment: str = "", items: str = ""):
    from api import storemap
    name = _map_store(store)
    prompt = storemap.next_prompt(
        name, focus=storemap.get_focus(name), seg_id=segment or None,
        hint_items=[i for i in items.split(",") if i.strip()][:30])
    return {"prompt": prompt}


@router.post("/api/storemap/outdated")
async def storemap_outdated(req: Request):
    """"The map is outdated": flag a segment (or the segment of an
    item) and answer with the capture the engine wants."""
    from api import storemap
    body = await _json_obj(req)
    return storemap.flag_outdated(
        _map_store(body.get("store")), seg_id=body.get("segment"),
        item=body.get("item"), reason=body.get("reason") or "outdated")


@router.get("/api/storemap/photo")
def storemap_photo(store: str = "", segment: str = ""):
    """The segment's best kept photo (people already scrubbed), or the
    walkthrough frame a seeded segment started from."""
    from api import storemap
    name = _map_store(store)
    data = storemap.best_image(name, segment)
    if data is not None:
        return Response(content=data, media_type="image/jpeg")
    frame = storemap.baseline_frame(name, segment)
    if frame and storemap.store_key(name) == storemap.store_key("Trader Joe's"):
        path = os.path.join(_PWA, "models", "trader-joes", "frames-web", frame)
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                return Response(content=fh.read(), media_type="image/jpeg")
    raise HTTPException(404, "no photo for this part of the map yet")


@router.post("/api/storemap/capture")
async def storemap_capture(req: Request):
    """One guided capture: a photo, or one frame the app picked from a
    walk video. The frame goes through the SAM 3.1 people scrub first
    and fails closed; then the engine grades it, drops it if it
    repeats a better view, and keeps the best few per segment. A weak
    capture is refused with a one-line fix to retake."""
    from api import shelfscan, storemap
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    name = _map_store(req.query_params.get("store"))
    seg_id = req.query_params.get("segment", "")
    kind = req.query_params.get("kind", "photo")
    if seg_id not in storemap.load_map(name)["segments"]:
        raise HTTPException(404, "no such part of the map")
    try:
        storemap.score_image(body)
    except Exception:
        raise HTTPException(400, "that file is not a readable photo")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    jpeg, people = await run_in_threadpool(
        shelfscan.scrub_people, body, client, media_type=media)
    if jpeg is None:
        raise HTTPException(
            503, "could not blur people out of the photo, so nothing was kept")
    # Shelf fill: live SAM returns one box per shelf bay, so fill is
    # the SUM of the box areas (capped at 1), not the largest box. It
    # is measured on the scrubbed JPEG, so no raw frame is sent twice.
    fill = None
    try:
        boxes, _u, _c = await run_in_threadpool(
            client.segment, jpeg, "grocery shelf", media_type="image/jpeg")
        if boxes:
            from PIL import Image
            import io
            w, h = Image.open(io.BytesIO(jpeg)).size
            fill = min(1.0, sum((b["box"][2] - b["box"][0])
                                * (b["box"][3] - b["box"][1])
                                for b in boxes) / float(w * h))
    except Exception:
        fill = None   # neutral: the fill check never blocks a capture
    try:
        out = storemap.ingest(name, seg_id, jpeg, kind=kind,
                              shelf_fill=fill, people=people)
    except ValueError as e:
        raise HTTPException(400, str(e))
    out["reward"] = storemap.award(name, out)
    return out


@router.post("/api/storemap/teach")
async def storemap_teach(req: Request):
    """Zero-entry teach (owner, 2026-10-28: "no user is going to
    enter data"). One frame with NO segment named: the people scrub
    runs first, the section reader names what the scrubbed frame
    shows, that section is found-or-created (both sides — the
    shopper never picks one), and the frame lands in it like any
    guided capture. The walk sends its sharpest frames one by one;
    sections the reader gets wrong come back out through the
    confirm card's discard, while they are still the teacher's own.
    """
    from api import mapread, shelfscan, storemap
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    name = _map_store(req.query_params.get("store"))
    kind = req.query_params.get("kind", "walk")
    if kind not in storemap.KINDS:
        raise HTTPException(400, "kind must be photo or walk")
    try:
        storemap.score_image(body)
    except Exception:
        raise HTTPException(400, "that file is not a readable photo")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    jpeg, people = await run_in_threadpool(
        shelfscan.scrub_people, body, client, media_type=media)
    if jpeg is None:
        raise HTTPException(
            503, "could not blur people out of the photo, so nothing was kept")
    try:
        read = await run_in_threadpool(mapread.read_section, client, jpeg)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not read["label"]:
        raise HTTPException(422, "no shelf in that frame — nothing kept")
    try:
        seg, created = storemap.add_segment(name, read["label"], "both")
    except ValueError as e:
        raise HTTPException(400, str(e))
    fill = None
    try:
        boxes, _u, _c = await run_in_threadpool(
            client.segment, jpeg, "grocery shelf", media_type="image/jpeg")
        if boxes:
            from PIL import Image
            import io
            w, h = Image.open(io.BytesIO(jpeg)).size
            fill = min(1.0, sum((b["box"][2] - b["box"][0])
                                * (b["box"][3] - b["box"][1])
                                for b in boxes) / float(w * h))
    except Exception:
        fill = None   # neutral: the fill check never blocks a capture
    try:
        out = storemap.ingest(name, seg["id"], jpeg, kind=kind,
                              shelf_fill=fill, people=people)
    except ValueError as e:
        raise HTTPException(400, str(e))
    for item in read["items"]:
        storemap.note_sighting(name, item, read["label"])
    out.update({"label": seg["label"], "created": created,
                "items": read["items"]})
    out["reward"] = storemap.award(name, out)
    return out


@router.post("/api/storemap/discard")
async def storemap_discard(req: Request):
    """The confirm card's "Not a section": retract a section the
    signed-in shopper just taught, while it is still only theirs."""
    from api import storemap
    body = await _json_obj(req)
    try:
        label = storemap.discard_segment(
            _map_store(body.get("store")), str(body.get("segment") or ""))
    except KeyError:
        raise HTTPException(404, "no such part of the map")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"removed": True, "label": label}


@router.post("/api/storemap/split")
async def storemap_split(req: Request):
    """The app timed a walk and asks for the aisle to be split into
    sections. Idempotent: an already-split aisle returns its sections."""
    from api import storemap
    body = await _json_obj(req)
    try:
        kids, created = storemap.split_segment(
            _map_store(body.get("store")), str(body.get("segment") or ""),
            body.get("parts"))
    except KeyError:
        raise HTTPException(404, "no such part of the map")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"created": created,
            "segments": [{"id": k["id"], "label": k["label"]} for k in kids]}
