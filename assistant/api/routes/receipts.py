"""The receipt archive: list, detail, original image, delete."""
from fastapi import APIRouter, HTTPException
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
