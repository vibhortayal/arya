"""The receipt archive: list, detail, original image, delete."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from api import state

router = APIRouter()


@router.get("/api/quest/receipts")
def quest_receipt_archive():
    from api import social
    return {"receipts": social.receipt_archive(),
            "unsettled": social.unsettled_hunts()}


@router.get("/api/quest/receipts/{receipt_id}")
def quest_receipt_detail(receipt_id: str):
    from api import social
    detail = social.receipt_detail(receipt_id)
    if detail is None:
        raise HTTPException(404, "no such receipt")
    return detail


@router.get("/api/quest/receipts/{receipt_id}/original")
def quest_receipt_original(receipt_id: str):
    """The kept original upload for a filed receipt (Discussion
    42): the caller's own bytes, served at their recorded media
    type. The lookup runs over the receipts the caller can see
    (their own, and each group member's) and the demo files nothing. A
    receipt filed without an upload (seeded history, order
    text) has no original and 404s honestly."""
    rec = next((r for r in state.receipts()
                if r["receipt_id"] == receipt_id), None)
    if rec is None or not rec.get("image_ref"):
        raise HTTPException(404, "no original kept for this receipt")
    data = state.receipt_media(receipt_id)
    if data is None:
        raise HTTPException(404, "no original kept for this receipt")
    return Response(content=data,
                    media_type=rec.get("media_type")
                    or "application/octet-stream",
                    headers={"Content-Disposition": "inline"})


@router.post("/api/quest/receipts/{receipt_id}/delete")
def quest_delete_receipt(receipt_id: str):
    """Delete a filed receipt (Tranche 1): the record and its kept
    original go; hunts it settled return to unsettled; the ledger
    and patterns recompute from what remains."""
    from api import quest, state
    if state.in_sandbox():
        raise HTTPException(403, "the demo household files nothing")
    owner = state.receipt_owner(receipt_id)
    if owner and owner != state._current_user.get():
        # A receipt belongs to the account that filed it (owner,
        # 2026-10-29); group members can see it but not delete it.
        from api.groups import handle
        raise HTTPException(403, f"only @{handle(owner)} can delete this receipt")
    rec = state.delete_receipt(receipt_id)
    if rec is None:
        raise HTTPException(404, "no such receipt")
    quest.detach_receipt(receipt_id)
    return {"ok": True, "deleted": receipt_id}


def _num(body, key, lo, hi):
    v = body.get(key)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
        raise HTTPException(400, f"{key} must be a number from {lo} to {hi}")
    return v


@router.post("/api/receipts/{receipt_id}/lines/{idx}")
async def receipt_line_edit(receipt_id: str, idx: int, req: Request):
    """The full line edit (owner, 2026-11-01): {name?, qty?, line_total?};
    only the fields sent change. A name works like To check's rename
    (teaches the name, fixes the same item on other receipts). The
    printed total never changes; totals_reconcile says whether the lines
    still add up to it. Undo is the same call with the old values."""
    from api.deps import _json_obj
    from api.routes.review import _rename
    body = await _json_obj(req)
    qty = _num(body, "qty", 0.001, 999)
    if qty is not None and qty <= 0:
        raise HTTPException(400, "qty must be more than 0")
    total = _num(body, "line_total", -10000, 10000)
    name = body.get("name")
    name = name.strip()[:120] if isinstance(name, str) else ""
    if qty is None and total is None and not name:
        raise HTTPException(400, "send name, qty or line_total")
    before = state.receipt_line(receipt_id, idx)
    if before is None:
        raise HTTPException(404, "no such line")
    if total is not None:
        # Returns and discounts keep their sign; an item is never negative.
        if before.get("line_type") in ("discount", "return"):
            total = -abs(total)
        elif total < 0:
            raise HTTPException(400, "line_total must be 0 or more for an item")
    others = []
    if name and name != before.get("decoded_name"):
        line, others = _rename(receipt_id, idx, name, body.get("section"))
        if line is None:
            raise HTTPException(404, "no such line")
    line, summary = state.edit_receipt_line(receipt_id, idx, qty=qty, line_total=total)
    if line is None:
        raise HTTPException(404, "no such line")
    return {"ok": True, "also": len(others), "undo": others,
            "line": {k: line.get(k) for k in ("decoded_name", "qty", "unit_price", "line_total",
                                              "line_type", "edited_from")},
            "totals_reconcile": bool(summary["adds_up"]), **summary}
