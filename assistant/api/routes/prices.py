"""Prices from the household's own receipts, and the price-sharing
choice (opt-in; nothing is shared yet)."""
from fastapi import APIRouter, Request

from api import prices, state
from api.deps import _json_obj

router = APIRouter()

SETTINGS = "settings.json"


@router.get("/api/prices/item/{item_id}")
def price_item(item_id: str, at: str = ""):
    """`at` names the store the user is looking at (the list's store),
    so "cheaper" compares against it."""
    iid = state.group_map().get(item_id, item_id)
    d = state.derived()
    nm = state.names_with_receipts()
    out = prices.item_prices(iid, d, at=at or None)
    out["similar"] = prices.similar_items(iid, d, nm)
    size = prices.size_of(nm.get(iid, ""))
    mine = [s for s in out["stores"].values()]
    if size and size[1] > 0 and mine:
        latest = max(mine, key=lambda s: s["last_date"])
        out["per"], out["per_price"] = size[0], round(latest["last"] / size[1], 3)
    return out


@router.get("/api/prices/insights")
def price_insights():
    from api.deps import _d_today
    d = state.derived()
    return prices.insights(d, state.flags(), state.names_with_receipts(), today=_d_today().isoformat())


def _settings():
    s = state._load(SETTINGS, {})
    return s if isinstance(s, dict) else {}


@router.get("/api/powers")
def powers_state():
    """The facts the Powers page needs to say what is on and what is
    locked: receipts on file, stores bought at, and the sharing choice."""
    rs = state.receipts()
    stores = {r.get("merchant") for r in rs if r.get("merchant")}
    return {"receipts": len(rs), "stores": len(stores),
            "share_prices": bool(_settings().get("share_prices"))}


@router.post("/api/powers/share")
async def powers_share(req: Request):
    """Record the opt-in. Sharing itself starts when the community
    price store ships; until then this is only the household's choice."""
    body = await _json_obj(req)
    s = _settings()
    s["share_prices"] = bool(body.get("on"))
    state._save(SETTINGS, s)
    return {"share_prices": s["share_prices"]}
