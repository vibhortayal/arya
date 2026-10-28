"""Pack — the pre-hunt list step (Pack slice).

Facts the Pack screen deals from, all deterministic and $0 (no model,
no Meta call, nothing here imports meta_client):

  item_facts(d)      per item: typical quantity, median unit price,
                     median unit price by store
  carried(list)      items the shopper left for next time (contract
                     C3): read from sess.left of earlier hunts
  enrich_plan(...)   the /api/quest/plan payload plus has_history,
                     carried, queued and the per-item facts
  variants(name)     past products a typed name could mean
  GET /api/pack/variants?name=

Prices are facts about the household's own receipts. They go to the
phone that asks and nowhere else: the estimate and the budget are
computed and kept on the phone.
"""
import statistics
import time

from fastapi import APIRouter

from api import state

router = APIRouter()

CARRY_DAYS = 30
CARRY_CAP = 8
VARIANTS_CAP = 8


def _num(x):
    """Whole numbers stay whole in JSON (2.0 -> 2)."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def _unit_price(e):
    """Unit price of one purchase entry. The ledger price is the NET
    LINE TOTAL, so the unit price is price / qty. Only positive
    values count; a zero or negative one is dropped."""
    try:
        price, qty = float(e.get("price") or 0), float(e.get("qty") or 0)
    except (TypeError, ValueError):
        return None
    if price <= 0 or qty <= 0:
        return None
    return price / qty


def _purchases(d):
    return [e for e in d["entries"] if e.get("event_type") == "purchase"]


def item_facts(d):
    """{item_id: {typical_qty, price, prices}} for every purchased
    item. price = median unit price over all stores; prices = the
    median unit price per store."""
    units = {}
    for e in _purchases(d):
        u = _unit_price(e)
        if u is None:
            continue
        units.setdefault(e["item_id"], []).append((e.get("store_id"), u))
    pats = {p["item_id"]: p for p in d["patterns"]}
    out = {}
    for iid in {e["item_id"] for e in _purchases(d)}:
        rows = units.get(iid, [])
        by_store = {}
        for store, u in rows:
            if store:
                by_store.setdefault(store, []).append(u)
        tq = (pats.get(iid) or {}).get("typical_qty")
        out[iid] = {
            "typical_qty": _num(tq) if tq else None,
            "price": round(statistics.median([u for _, u in rows]), 2) if rows else None,
            "prices": {s: round(statistics.median(v), 2) for s, v in by_store.items()},
        }
    return out


# --- carried: items left for next time (contract C3) -------------------

def _norm(s):
    return state._norm_name(s)


def carried(list_rows, now=None):
    """Items earlier hunts saved for next time, newest hunt first.

    Reads sess.left entries with how == "saved" from finished or done
    hunts created in the last 30 days (placeholders and open hunts
    are ignored). An entry is skipped when a later hunt already has
    its group on its items, or when the Arya list already has the
    same group or normalised name. One row per group, at most 8.
    Dropped entries are never carried."""
    from api import quest
    now = time.time() if now is None else now
    sessions = [s for s in quest._store()["sessions"] if not s.get("placeholder")]
    sessions.sort(key=lambda s: -quest._ts(s.get("created_at", "")))
    on_list_groups = {r.get("item_id") for r in list_rows or []}
    on_list_names = {_norm(r.get("name")) for r in list_rows or []}
    out, seen = [], set()
    for sess in sessions:
        if sess.get("state") not in ("finished", "done"):
            continue
        made = quest._ts(sess.get("created_at", ""))
        if made <= 0 or now - made > CARRY_DAYS * 86400:
            continue
        later = [s for s in sessions if quest._ts(s.get("created_at", "")) > made]
        for ent in sess.get("left") or []:
            if not isinstance(ent, dict) or ent.get("how") != "saved":
                continue
            name = (ent.get("name") or "").strip()
            if not name:
                continue
            group = ent.get("group") or "name:" + _norm(name)
            if group in seen:
                continue
            if any(i.get("group") == group for s in later for i in s.get("items") or []):
                continue
            if group in on_list_groups or _norm(name) in on_list_names:
                continue
            seen.add(group)
            out.append({
                "name": name, "qty": max(1, int(ent.get("qty") or 1)),
                "group": group,
                "note": ent.get("note") or "", "variant": ent.get("variant") or "",
                "by": ent.get("by") or "", "aisle": ent.get("aisle") or "",
                "from_session": sess.get("id")})
            if len(out) >= CARRY_CAP:
                return out
    return out


def _queued():
    """The Same-haul queue (HAUL slice, contract C4), read through a
    guarded lazy import: no haul module, no queue."""
    try:
        from api import haul
        rows = haul.queued_list()
        return [r for r in rows if isinstance(r, dict)]
    except Exception:
        return []


# --- the plan payload -------------------------------------------------

def enrich_plan(plan, d):
    """Add the Pack facts to the /api/quest/plan payload. Old keys
    stay as they were."""
    gm = state.group_map()
    facts = item_facts(d)
    for it in plan.get("items", []):
        f = facts.get(it["item_id"]) or {}
        it["typical_qty"] = f.get("typical_qty")
        it["price"] = f.get("price")
        it["prices"] = f.get("prices") or {}
    smart = {}
    by_name = {}
    for s in d["smart_list"]["items"]:
        smart.setdefault(gm.get(s.get("item_id"), s.get("item_id")), s)
        by_name.setdefault(_norm(s.get("name")), s)
    for row in plan.get("list", []):
        s = smart.get(row.get("item_id")) or by_name.get(_norm(row.get("name"))) or {}
        row["reason"] = s.get("due_reason") or s.get("judge_reason") or ""
        row["source"] = s.get("source") or ""
        row["added_by"] = s.get("added_by") or ""
        row["approved"] = bool(s.get("approved"))
    plan["has_history"] = bool(_purchases(d))
    try:
        plan["carried"] = carried(plan.get("list", []))
    except Exception:
        plan["carried"] = []
    plan["queued"] = _queued()
    return plan


# --- variants ---------------------------------------------------------

def variants(name):
    """Past products a typed name could mean, from the dictionary:
    [{name, count, last_price}], most bought first. last_price is the
    unit price of the latest purchase (None when there is none)."""
    from api import optimizer
    name = (name or "").strip()[:80]
    if not _norm(name):
        return []
    gm = state.group_map()
    exact, fuzzy = optimizer._candidates(name)
    pool, seen = [], set()
    for e in exact + fuzzy:
        if e["item_id"] not in seen:
            pool.append(e)
            seen.add(e["item_id"])
    reps = optimizer._collapse(pool, gm)
    d = state.derived()
    buys = {}
    for e in _purchases(d):
        buys.setdefault(e["item_id"], []).append(e)
    out = []
    for e in reps:
        rep = gm.get(e["item_id"], e["item_id"])
        rows = sorted(buys.get(rep, []), key=lambda x: x.get("date") or "")
        last = None
        for r in reversed(rows):
            u = _unit_price(r)
            if u is not None:
                last = round(u, 2)
                break
        out.append({"name": state.names().get(rep, e["canonical_name"]),
                    "count": len(rows), "last_price": last})
    out.sort(key=lambda v: (-v["count"], v["name"]))
    return out[:VARIANTS_CAP]


@router.get("/api/pack/variants")
def pack_variants(name: str = ""):
    return {"variants": variants(name)}
