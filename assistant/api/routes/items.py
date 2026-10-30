"""One tracked item: its page, expired mark and flags."""
from fastapi import APIRouter, HTTPException, Request

from api import state
from api.deps import _json_obj

router = APIRouter()


@router.get("/api/items/{item_id}")
def item_route(item_id: str):
    detail = state.item_detail(item_id)
    # The page offers "Add to list" only when it is not on one already.
    detail["on_list"] = any(i["item_id"] == item_id and i.get("on_list")
                            for i in state.derived()["smart_list"]["items"])
    if detail["entry"] is None and detail["pattern"] is None:
        # A typed item has no receipts yet: show its page with the name
        # it was typed as, instead of a 404 (first-timer play-test).
        typed = state.flags().get(item_id) or {}
        if typed.get("manual") and typed.get("name"):
            detail["entry"] = {"item_id": item_id, "canonical_name": typed["name"]}
            return detail
        raise HTTPException(404, "unknown item")
    return detail


@router.post("/api/items/{item_id}/expired")
def item_expired(item_id: str):
    from datetime import date as _d
    fl = state.flags()
    cur = dict(fl.get(item_id, {}))
    cur["expired"] = _d.today().isoformat()
    state.set_flag(item_id, cur)
    return {"item_id": item_id, "expired": cur["expired"]}


# The flag vocabulary — every key a flag record may carry. The
# flag route writes only these; anything else in a POST body is a
# caller bug and never lands in the store (review M6: an empty
# probe POST once left a junk record behind).
_FLAG_KEYS = {"manual", "never", "out", "expired", "snoozed_until",
              "dismissed_on", "checked_on", "check_ok", "qty_override",
              "name", "list", "use_by", "use_by_kind", "use_by_set", "use_by_snooze", "unit"}


@router.post("/api/items/{item_id}/flag")
async def flag_route(item_id: str, req: Request):
    body = await _json_obj(req)
    updates = {k: v for k, v in body.items() if k in _FLAG_KEYS}
    if not updates:
        raise HTTPException(400, "no recognized flag fields")
    merged = state.update_flag(item_id, lambda f: {**f, **updates})
    return {"item_id": item_id, "flags": merged}


def _merge_flag(item_id, fields):
    return state.update_flag(item_id, lambda f: {**f, **fields})
