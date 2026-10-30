"""The shopping list: add, remove, quantity, move, check, named lists, and the staple judge that gates admission."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import groups, state
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _int_field, _json_obj, new_client
from api.routes.items import _merge_flag

router = APIRouter()


@router.get("/api/list/candidates")
def list_candidates():
    d = state.derived()
    nm = state.names()
    on_list = {i["item_id"] for i in d["smart_list"]["items"]}
    return {"candidates": [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
                            "on_list": p["item_id"] in on_list}
                           for p in d["patterns"] if p["purchase_count"] >= 1]}


@router.post("/api/judge/run")
def judge_run():
    try:
        _budget_guard()
    except HTTPException:
        # Over today's budget: judge nothing, quietly, like a host
        # with no key. Verdicts catch up on the next run.
        return {"judged": 0, "paused": True}
    client = new_client()
    return {"judged": state.judge_pending(client)}


@router.post("/api/judge/second-seat")
def judge_second_seat():
    """The open-weights second seat re-judges this account's judged
    items by NAME only (no facts leave the hosted API) and records
    where it disagrees with the deciding verdict. Advisory only:
    judgments are never changed here."""
    from api.judge import second_seat_batch, second_seat_report
    from api.open_client import OpenClient
    judged = state.judgments()
    if not judged:
        return {"checked": 0, "agreed": 0, "disagreements": []}
    _budget_guard()
    client = OpenClient()
    if not client.api_key:
        # Not provisioned on this host yet: a quiet no-op, the same
        # contract judge/run keeps when no Meta key is set.
        return {"checked": 0, "agreed": 0, "disagreements": [],
                "provisioned": False}
    nm = state.names()
    items = [(iid, nm.get(iid, iid)) for iid in judged]
    verdicts = {}
    for i in range(0, len(items), 25):
        verdicts.update(second_seat_batch(client, items[i:i + 25]))
    report = second_seat_report(verdicts, judged, nm)
    state.save_second_seat(report)
    return report


def _add_name_to_list(name, qty=1, list_id=None, unit=""):
    """A typed/pasted/read name joins the list as a manual item —
    the one add path every Add surface shares. A typed quantity
    ("eggs x 2") rides along as the item's quantity."""
    from api.list.intake import existing_item_id, item_slug
    name = (name or "").strip()
    known = existing_item_id(name, state.dictionary()["entries"], state.flags())
    if known:
        # Already tracked, or already typed in: the same row, not a twin.
        # Typed again means wanted again: a tick from this trip comes
        # off, and an add from inside a list files it there (QA
        # 2026-10-30: "bananas" on Trader Joe's went to Everything else).
        flag = {"manual": True, "dismissed_on": None, "checked_on": None}
        if list_id:
            flag["list"] = list_id
        if qty and qty != 1:
            flag["qty_override"] = qty
        if unit:
            flag["unit"] = unit
        _merge_flag(known, flag)
        return {"item_id": known, "name": state.flags().get(known, {}).get("name")
                or state.names().get(known, name)}
    item_id = "manual-" + item_slug(name)
    flag = {"manual": True, "name": name, "dismissed_on": None}
    if qty and qty != 1:
        flag["qty_override"] = qty
    if unit:
        flag["unit"] = unit
    if list_id:
        flag["list"] = list_id
    _merge_flag(item_id, flag)
    return {"item_id": item_id, "name": name}


def _list_add_fields(body):
    """Validate the Pack extras of an add BEFORE anything is written.
    Returns the flag fields to set; raises 400 on a bad quantity."""
    qty = body.get("qty")
    fields = {}
    list_id = body.get("list_id")
    if list_id:
        if not any(l["id"] == list_id for l in state.named_lists()):
            raise HTTPException(404, "no such list")
        fields["list"] = list_id
    if qty is not None and not isinstance(qty, bool):
        try:
            n = int(qty)
        except (TypeError, ValueError):
            raise HTTPException(400, "qty must be a whole number")
        if n >= 1:
            fields["qty_override"] = min(n, 99)
    return fields


def _list_add_extras(item_id, body, fields):
    """Pack slice: an add may carry a quantity (stored as the list
    row's qty_override), who added it (flag added_by, at most 24
    characters) and approved (the grown-up said yes to that add).
    Only an add that carries a "by" key changes the name: a later add
    with no "by" key, such as an Undo of a removal, leaves it alone;
    an empty "by" clears it."""
    from api.itemmeta import clean_extras

    def change(merged):
        merged.update(fields)
        if "by" in body:
            by = clean_extras({"by": body.get("by")}).get("by")
            if by:
                merged["added_by"] = by
            else:
                merged.pop("added_by", None)
            merged.pop("approved", None)
        if body.get("approved") is True:
            merged["approved"] = True
        return merged
    state.update_flag(item_id, change)


@router.post("/api/list/add")
async def list_add(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id and not body.get("name"):
        raise HTTPException(400, "item_id or name is required")
    fields = _list_add_fields(body)  # a bad qty fails before any write
    if not item_id:
        # A typed quantity ("eggs x 2") rides along; a qty in the body wins.
        from api.list.intake import split_list_items_units, clean_unit
        typed = split_list_items_units(str(body["name"]))
        name, qty, unit = typed[0] if len(typed) == 1 else (body["name"], 1, "")
        unit = clean_unit(body["unit"]) if "unit" in body else unit
        item_id = _add_name_to_list(name, qty, unit=unit)["item_id"]
        _list_add_extras(item_id, body, fields)
        groups.note("added", item_id)
        return {"item_id": item_id}
    _merge_flag(item_id, {"manual": True, "dismissed_on": None})
    _list_add_extras(item_id, body, fields)
    groups.note("added", item_id)
    return {"item_id": item_id}


@router.post("/api/list/from-text")
async def list_from_text(req: Request):
    """Typed or pasted list text -> list adds. The split is
    deterministic code ($0); only when it yields nothing sensible
    (chat text with chatter in it) does one Spark Standard
    extraction call run."""
    body = await _json_obj(req)
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    list_id = (body.get("list_id") or None)
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    from api.list.intake import (split_list_items_units, extract_items_model,
                                 skipped_pieces, has_non_latin)
    from api.chat_service import _language_setting
    # The splitter is English-shaped ("add", "and", "some"). Non-Latin
    # script, or a fixed non-English language, goes to the one Spark
    # call instead so "agrega leche" files "leche"; English on auto
    # keeps the $0 split (assistant/docs/MULTILINGUAL-ASK.md §3).
    by_model = bool(os.environ.get("MODEL_API_KEY")) and (
        has_non_latin(text) or _language_setting() in ("es", "hi"))
    typed = [] if by_model else split_list_items_units(text)
    skipped = skipped_pieces(text) if typed else []
    names = [n for n, _q, _u in typed]
    source = "split"
    if not names:
        if not os.environ.get("MODEL_API_KEY"):
            raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
        _budget_guard()
        client = new_client()
        names = extract_items_model(text, client)
        typed = [(n, 1, "") for n in names]
        source = "model"
    before = {i["item_id"]: i for i in state.derived()["smart_list"]["items"]
              if i.get("on_list")}
    lists = {l["id"]: l["name"] for l in state.named_lists()}
    added = [_add_name_to_list(n, q, list_id, u) for n, q, u in typed]
    # Already on the list, unticked and on this list: not "added". A
    # ticked row comes back and a row on another list moves here; the
    # toast names both so the add never looks like it did nothing.
    already, already_names, back, moved = 0, [], [], []  # names for the toast
    for a in added:
        was = before.get(a["item_id"])
        if was is None:
            continue
        if was.get("checked"):
            back.append(a["name"])
        elif list_id and was.get("list") != list_id:
            moved.append({"name": a["name"],
                          "from": lists.get(was.get("list")) or ""})
        else:
            already += 1
            already_names.append({"name": a["name"],
                                  "list": lists.get(was.get("list")) or ""})
    return {"added": len(added) - already, "already": already,
            "already_names": already_names, "back": back, "moved": moved,
            "names": [a["name"] for a in added], "source": source,
            "skipped": skipped,
            # Only what newly joined the list: the client's Undo.
            "item_ids": [a["item_id"] for a in added if a["item_id"] not in before]}


@router.post("/api/list/judge")
async def list_judge(req: Request):
    """Settle the list's unknown names: the typed items the rules and
    the aisle map do not know. One batched Spark Standard call at most,
    and each name is asked once ever (the verdict is cached). Nothing
    is removed or blocked; the client shows "Not a grocery item?
    Added anyway" for what comes back flagged. No key or a failed
    call just leaves the names unknown (treated as groceries)."""
    from api.list import grocery
    verdicts = grocery.load_verdicts()
    unknown = []
    for i in state.derived()["smart_list"]["items"]:
        if i.get("source") != "user":
            continue
        if grocery.classify(i["name"], verdicts)["kind"] == "unknown" \
                and not verdicts.get(_key_of(i["name"])):
            unknown.append(i["name"])
    if not unknown or not os.environ.get("MODEL_API_KEY"):
        return {"judged": 0, "flagged": []}
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    found = await run_in_threadpool(grocery.judge_unknown, unknown, client)
    if found:
        verdicts = grocery.save_verdicts(found)
    flagged = [i["item_id"] for i in state.derived()["smart_list"]["items"]
               if i.get("not_grocery")]
    return {"judged": len(found), "flagged": flagged}


def _key_of(name):
    from api.list.intake import _key
    return _key(name)


@router.post("/api/list/grocery-verdict")
async def list_grocery_verdict(req: Request):
    """The user's word on one item: kind "grocery" (Keep: it is fine)
    or "other". Saved by name, beats every rule and model verdict."""
    body = await _json_obj(req)
    item = next((i for i in state.derived()["smart_list"]["items"]
                 if i["item_id"] == body.get("item_id")), None)
    kind = body.get("kind")
    if not item or kind not in ("grocery", "other"):
        raise HTTPException(400, "item_id on the list and kind grocery|other required")
    from api.list.grocery import set_user_verdict
    set_user_verdict(item["name"], kind)
    return {"item_id": item["item_id"], "kind": kind}


@router.post("/api/list/from-photo")
async def list_from_photo(req: Request):
    """The Add tab's camera: one Spark vision read. A list photo
    (handwritten, whiteboard) adds its items to the list; a receipt
    photo adds nothing — it is reported as a receipt so the client
    can offer to file it (receipts enter by image, through
    /decode/photo). The demo runs the same live read and persists
    nothing."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    # The list the photo was taken from (?list_id=): its items go there.
    list_id = req.query_params.get("list_id") or None
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    from api.list.intake import read_list_photo
    client = new_client()
    try:
        read = await run_in_threadpool(read_list_photo, body, client,
                                       media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    if read["kind"] == "receipt":
        return {"kind": "receipt", "names": [], "added": 0}
    # The demo adds too: its writes land in the visitor's sandbox.
    added = [_add_name_to_list(n, list_id=list_id) for n in read["items"]]
    return {"kind": "list", "names": [a["name"] for a in added],
            "added": len(added), "demo": demo}


@router.post("/api/list/remove")
async def list_remove(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    _merge_flag(item_id, {"manual": False, "dismissed_on": state.cycle()})
    groups.note("removed", item_id)
    return {"ok": True}


@router.post("/api/list/qty")
async def list_qty(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    from api.list.intake import amount, clean_unit
    flag = {}
    if "unit" in body:
        flag["unit"] = clean_unit(body["unit"])  # "" clears it
    unit = flag["unit"] if "unit" in flag else state.flags().get(item_id, {}).get("unit")
    if unit:
        # An amount with a unit keeps one decimal: 1.5 gal, 0.5 kg.
        try:
            flag["qty_override"] = amount(body.get("qty", 1))
        except (TypeError, ValueError):
            raise HTTPException(400, "qty must be a number")
    else:
        flag["qty_override"] = max(1, _int_field(body, "qty", 1))
    _merge_flag(item_id, flag)
    return {"ok": True}


# ---- Named lists (owner, 2026-10-29): Costco, Trader Joe's, Indian
# Store, Party... An item sits on one list at a time (flag "list");
# an item on no list shows under "Everything else". Deleting a list
# never touches its items, so Undo is just restoring the list record.

def _clean_list_fields(body, current=None):
    """Validate a list's name and stores from a request body."""
    out = {}
    if "name" in body or current is None:
        name = " ".join(str(body.get("name") or "").split())[:40]
        if not name:
            raise HTTPException(400, "give the list a name")
        out["name"] = name
    if "stores" in body or current is None:
        raw = body.get("stores") or []
        if not isinstance(raw, list):
            raise HTTPException(400, "stores must be a list of names")
        stores = []
        for st in raw:
            st = " ".join(str(st or "").split())[:60]
            if st and st.lower() not in {x.lower() for x in stores}:
                stores.append(st)
        out["stores"] = stores[:state.MAX_LIST_STORES]
    return out


def _check_list_name_free(rows, name, own_id=None):
    if any(l["id"] != own_id and l["name"].lower() == name.lower() for l in rows):
        raise HTTPException(409, f"you already have a list called {name}")


@router.get("/api/lists")
def lists_get():
    return {"lists": state.named_lists()}


@router.post("/api/lists")
async def lists_create(req: Request):
    import uuid
    body = await _json_obj(req)
    fields = _clean_list_fields(body)
    rows = state.named_lists()
    if len(rows) >= state.MAX_LISTS:
        raise HTTPException(400, f"{state.MAX_LISTS} lists is the most for now")
    _check_list_name_free(rows, fields["name"])
    row = {"id": "l-" + uuid.uuid4().hex[:8], **fields}
    state.save_named_lists(rows + [row])
    return row


@router.post("/api/lists/update")
async def lists_update(req: Request):
    body = await _json_obj(req)
    rows = state.named_lists()
    row = next((l for l in rows if l["id"] == body.get("id")), None)
    if row is None:
        raise HTTPException(404, "no such list")
    fields = _clean_list_fields(body, current=row)
    if "name" in fields:
        _check_list_name_free(rows, fields["name"], own_id=row["id"])
    row.update(fields)
    state.save_named_lists(rows)
    return row


@router.post("/api/lists/delete")
async def lists_delete(req: Request):
    body = await _json_obj(req)
    rows = state.named_lists()
    row = next((l for l in rows if l["id"] == body.get("id")), None)
    if row is None:
        raise HTTPException(404, "no such list")
    state.save_named_lists([l for l in rows if l is not row])
    # Items keep their (now dangling) list id, so restoring the same
    # record brings them straight back; until then they read as
    # "Everything else".
    return {"deleted": row, "index": rows.index(row)}


@router.post("/api/lists/restore")
async def lists_restore(req: Request):
    """Undo of a delete: put the same record back at its place."""
    body = await _json_obj(req)
    rec = body.get("list") or {}
    fields = _clean_list_fields(rec)
    lid = str(rec.get("id") or "")
    if not lid.startswith("l-"):
        raise HTTPException(400, "list id is required")
    rows = state.named_lists()
    if any(l["id"] == lid for l in rows):
        return {"list": next(l for l in rows if l["id"] == lid)}
    _check_list_name_free(rows, fields["name"])
    row = {"id": lid, **fields}
    idx = body.get("index")
    idx = idx if isinstance(idx, int) and 0 <= idx <= len(rows) else len(rows)
    rows.insert(idx, row)
    state.save_named_lists(rows)
    return {"list": row}


@router.post("/api/list/move")
async def list_move(req: Request):
    """File an item under a list, or under no list (list_id null)."""
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    list_id = body.get("list_id") or None
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    _merge_flag(item_id, {"list": list_id})
    return {"ok": True}


@router.post("/api/list/check")
async def list_check(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"],
                {"checked_on": state.cycle() if body.get("checked") else None})
    if body.get("checked"):
        groups.note("ticked", body["item_id"])
    return {"ok": True}


@router.post("/api/list/check-ok")
async def list_check_ok(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"], {"check_ok": state.cycle()})
    return {"ok": True}
