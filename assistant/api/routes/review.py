"""Receipt review: suggestions, the review queue, and line-by-line resolution."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import state
from api.deps import _budget_guard, _int_field, _json_obj, new_client

router = APIRouter()


@router.post("/api/review/suggest")
async def review_suggest(req: Request):
    """Researched candidates for an unresolved item, posted by the
    user's Muse (the Resolver loop). Candidates carry their source;
    settling still takes the user's word."""
    body = await _json_obj(req)
    if body.get("receipt_id"):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "a line suggestion needs a name")
        if not state.suggest_line(body["receipt_id"],
                                  _int_field(body, "idx", -1),
                                  name, body.get("source", "")):
            raise HTTPException(404, "no unverified line with that id")
        return {"ok": True, "name": name}
    cands = body.get("candidates") or []
    clean = [{"name": c["name"], "source": c.get("source", "")}
             for c in cands if isinstance(c, dict) and c.get("name")]
    if not clean:
        raise HTTPException(422, "candidates need at least one name")
    if not state.suggest_resolution(body.get("item_id", ""), clean):
        raise HTTPException(404, "no unresolved item with that id")
    return {"ok": True, "candidates": [c["name"] for c in clean]}


@router.get("/api/review")
def review_route():
    return state.review_queue()


@router.post("/api/review/line")
async def review_line(req: Request):
    body = await _json_obj(req)
    action = body.get("action")
    receipt_id = body.get("receipt_id")
    if not receipt_id:
        raise HTTPException(400, "receipt_id is required")
    idx = _int_field(body, "idx")
    others = []
    if action == "confirm":
        before = state.receipt_line(receipt_id, idx)
        line = state.update_receipt_line(receipt_id, idx, {"status": "auto"})
        if line:
            others = state.apply_line_fix_to_same_item(
                receipt_id, idx, line, decoded_name=(before or {}).get("decoded_name"))
    elif action == "rename":
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "name is required to rename")
        line = state.update_receipt_line(receipt_id, idx,
                                         {"status": "auto", "decoded_name": name})
        if line:
            state.teach_name(line.get("sku"), name, item_id=line.get("item_id"))
            if body.get("section"):
                from api.dictionary import clean
                clean.save_section(line.get("sku"), line.get("item_id") or f"costco-{line.get('sku')}",
                                   str(body["section"]).lower())
            others = state.apply_line_fix_to_same_item(receipt_id, idx, line, name=name)
    else:
        raise HTTPException(400, "action must be confirm or rename")
    if line is None:
        raise HTTPException(404, "no such line")
    return {"ok": True, "also": len(others), "undo": others}


@router.post("/api/review/smart-pass")
async def review_smart_pass():
    """Arya proposes a clean name for each To check item that has none
    (one Spark text call per 25 items; items already tried are skipped).
    The screen calls this when it opens, then reads /api/review again."""
    from api.dictionary import clean
    if not os.environ.get("MODEL_API_KEY"):
        return {"suggested": await run_in_threadpool(clean.suggest_review, None)}
    _budget_guard()
    return {"suggested": await run_in_threadpool(clean.suggest_review, new_client())}


@router.post("/api/review/undo")
async def review_undo(req: Request):
    """Take back a group fix: the lines it changed go back as they were."""
    body = await _json_obj(req)
    changes = body.get("changes")
    if not isinstance(changes, list) or not all(
            isinstance(c, dict) and isinstance(c.get("receipt_id"), str)
            and isinstance(c.get("idx"), int) for c in changes):
        raise HTTPException(400, "changes must be a list of lines")
    return {"ok": True, "restored": state.undo_line_fixes(changes)}


@router.post("/api/review/resolve")
async def review_resolve(req: Request):
    body = await _json_obj(req)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    entry = state.resolve_dictionary(body.get("item_id"), name)
    if entry is None:
        raise HTTPException(404, "no such item")
    return {"ok": True}
