"""The shopping list: add, remove, quantity, move, check, named lists, and the staple judge that gates admission."""
import datetime
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import own_key
from api import groups, state
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _int_field, _json_obj, new_client
from api.routes.items import _merge_flag

log = logging.getLogger("arya.input")
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
    if not client.api_key or own_key.required():
        # An own-key account pays only for Meta reads on its own key;
        # the open-weights seat is the app's (BYOK review 2, change 7).
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


def _put_also(item_id, list_id, on=True):
    """An item can sit on more than one list (owner, 2026-10-30): its
    "list" is where it lives, "also" the others. Ticking is per list."""
    def change(f):
        f = dict(f)
        also = [a for a in (f.get("also") or []) if a != list_id]
        if on and f.get("list") != list_id:
            also.append(list_id)
        f["also"] = also
        ticks = dict(f.get("checked_in") or {})
        ticks.pop(list_id, None)
        f["checked_in"] = ticks
        return f
    state.update_flag(item_id, change)


def _add_name_to_list(name, qty=1, list_id=None, unit="", mode="both"):
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
        cur = state.flags().get(known, {})
        elsewhere = (cur.get("list") if cur.get("list") in {l["id"] for l in state.named_lists()} else None)
        if list_id and elsewhere and elsewhere != list_id and cur.get("manual") and mode == "both":
            # On another list already: people decide (owner, 2026-10-30).
            # It joins this one too; "Move here" is one tap in the toast.
            if list_id not in (cur.get("also") or []):
                _put_also(known, list_id)
            flag["checked_on"] = cur.get("checked_on")
        elif list_id:
            flag["list"] = list_id
            if list_id in (cur.get("also") or []):
                flag["also"] = [a for a in cur["also"] if a != list_id]
        if qty and qty != 1:
            flag["qty_override"] = qty
        if unit:
            flag["unit"] = unit
        _merge_flag(known, flag)
        return {"item_id": known, "name": state.flags().get(known, {}).get("name")
                or state.names().get(known, name)}
    item_id = "manual-" + item_slug(name)
    flag = {"manual": True, "name": name, "dismissed_on": None,
            "added_at": datetime.datetime.now(datetime.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ")}
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


@router.post("/api/list/sample-receipt")
async def list_sample_receipt(req: Request):
    """Demo only: a sample receipt for the items ticked in Just my list
    (retest 2026-10-31 #16), the tick-mode twin of the Quest's sample."""
    if not state.in_sandbox():
        raise HTTPException(403, "sample receipts are for the demo only")
    body = await _json_obj(req)
    ids = [str(i) for i in (body.get("item_ids") or []) if i][:60]
    from api import quest
    try:
        rec = quest.sample_list_receipt(str(body.get("store") or "")[:60], ids)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"merchant": rec["merchant"], "lines": len(rec["lines"]), "total": rec["total"]}


@router.post("/api/list/add")
async def list_add(req: Request):
    body = await _json_obj(req)
    # File writes (and any model call) off the event loop (re-audit #9).
    return await run_in_threadpool(_list_add, body)


def _list_add(body):
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
    if "list" not in fields and not state.flags().get(item_id, {}).get("list"):
        # Running low's Add and the like: the item's usual store's list (retest #5).
        home = state.usual_list(item_id)
        if home:
            fields["list"] = home
    _list_add_extras(item_id, body, fields)
    groups.note("added", item_id)
    return {"item_id": item_id}


def _add_typed(typed, list_id=None, source="split", skipped=()):
    """Add [(name, qty, unit)] to the list and report what happened:
    the one reply shape /api/list/from-text and the Lists API share."""
    before = {i["item_id"]: i for i in state.derived()["smart_list"]["items"]
              if i.get("on_list")}
    lists = {l["id"]: l["name"] for l in state.named_lists()}
    added = [_add_name_to_list(n, q, list_id, u) for n, q, u in typed]
    # Already on the list, unticked and on this list: not "added". A
    # ticked row comes back and a row on another list moves here; the
    # toast names both so the add never looks like it did nothing.
    already, already_names, back, moved, also = 0, [], [], [], []  # names for the toast
    for a in added:
        was = before.get(a["item_id"])
        if was is None:
            continue
        if was.get("checked"):
            back.append(a["name"])
        elif list_id and was.get("list") != list_id and list_id in (state.flags().get(a["item_id"], {}).get("also") or []):
            also.append({"name": a["name"], "item_id": a["item_id"],
                         "list": lists.get(was.get("list")) or ""})
        elif list_id and was.get("list") != list_id:
            moved.append({"name": a["name"],
                          "from": lists.get(was.get("list")) or ""})
        else:
            already += 1
            already_names.append({"name": a["name"],
                                  "list": lists.get(was.get("list")) or ""})
    return {"added": len(added) - already, "already": already,
            "already_names": already_names, "back": back, "moved": moved, "also": also,
            "names": [a["name"] for a in added], "source": source,
            "skipped": list(skipped),
            # Only what newly joined the list: the client's Undo.
            "item_ids": [a["item_id"] for a in added if a["item_id"] not in before],
            # Every row's item, in the order given (duplicates repeat).
            "all_item_ids": [a["item_id"] for a in added]}


@router.post("/api/list/from-text")
async def list_from_text(req: Request):
    """Typed or pasted list text -> list adds. The split is
    deterministic code ($0); only when it yields nothing sensible
    (chat text with chatter in it) does one Spark Standard
    extraction call run."""
    body = await _json_obj(req)
    # File writes (and any model call) off the event loop (re-audit #9).
    return await run_in_threadpool(_list_from_text, body)


def _list_from_text(body):
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
    by_model = bool(own_key.model_ready()) and (
        has_non_latin(text) or _language_setting() in ("es", "hi"))
    typed = [] if by_model else split_list_items_units(text)
    skipped = skipped_pieces(text) if typed else []
    names = [n for n, _q, _u in typed]
    source = "split"
    if not names:
        own_key.need_model()
        _budget_guard()
        client = new_client()
        names = extract_items_model(text, client)
        typed = [(n, 1, "") for n in names]
        source = "model"
        if not names:  # say what was left out instead of adding 0 in silence
            skipped = skipped_pieces(text)
    return _add_typed(typed, list_id, source, skipped)


@router.post("/api/list/import-preview")
async def list_import_preview(req: Request):
    """Read a paste (lines, CSV, JSON or anything) into a preview. Adds
    nothing. Items already on another list are marked with that list."""
    body = await _json_obj(req)
    # File writes (and any model call) off the event loop (re-audit #9).
    return await run_in_threadpool(_list_import_preview, body)


def _list_import_preview(body):
    text = body.get("text") or ""
    if not str(text).strip():
        raise HTTPException(400, "text is required")
    from api.list.importer import parse_paste

    def by_model(t):
        if not own_key.model_ready():
            return []
        _budget_guard()
        from api.list.intake import extract_items_model
        return extract_items_model(t, new_client())
    items, source = parse_paste(str(text), by_model)
    before = {i["item_id"]: i for i in state.derived()["smart_list"]["items"] if i.get("on_list")}
    lists = {l["id"]: l["name"] for l in state.named_lists()}
    from api.list.intake import existing_item_id
    ents, flags = state.dictionary()["entries"], state.flags()
    list_id = body.get("list_id") or None
    for it in items:
        known = existing_item_id(it["name"], ents, flags)
        was = before.get(known) if known else None
        it["on_list"] = bool(was)
        it["other_list"] = (lists.get(was.get("list")) or "") if was and was.get("list") != list_id and not was.get("checked") else ""
    return {"items": items, "source": source}


@router.post("/api/list/import")
async def list_import(req: Request):
    """Add the previewed items to one list: the same add path as typing."""
    body = await _json_obj(req)
    # File writes (and any model call) off the event loop (re-audit #9).
    return await run_in_threadpool(_list_import, body)


def _list_import(body):
    list_id = body.get("list_id") or None
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    rows = body.get("items")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(400, "items is required")
    from api import aisles
    from api.list.importer import MAX_ITEMS, _item
    before = {i["item_id"] for i in state.derived()["smart_list"]["items"] if i.get("on_list")}
    added = []
    for r in rows[:MAX_ITEMS]:
        it = _item(r.get("name"), r.get("qty") or 1, r.get("unit") or "", False, r.get("aisle") or "") if isinstance(r, dict) else None
        if not it:
            continue
        a = _add_name_to_list(it["name"], it["qty"], list_id, it["unit"],
                              mode="move" if body.get("mode") == "move" else "both")
        if it["aisle"] in aisles.AISLES or it["aisle"] == "Other":
            _merge_flag(a["item_id"], {"aisle": it["aisle"]})
        groups.note("added", a["item_id"])
        added.append(a)
    # Names that read as the same item fold into one row ("zz import3" and
    # "zz import4" into "zz import1"): count the rows that are new, and say
    # how many names folded into a row that was already there.
    new_ids, already, merged = [], 0, 0
    for a in added:
        i = a["item_id"]
        if i in before:
            already += 1
        elif i in new_ids:
            merged += 1
        else:
            new_ids.append(i)
    return {"added": len(new_ids), "already": already, "merged": merged,
            "names": [a["name"] for a in added], "item_ids": new_ids}


@router.get("/api/list/tidy")
def list_tidy(list_id: str = ""):
    """What Arya would tidy on one list: doubles, typed amounts, errands."""
    from api.list import tidy
    rows = [i for i in state.derived()["smart_list"]["items"]
            if i.get("on_list") and not i.get("checked") and (i.get("list") or "") == (list_id if list_id != "else" else "")]
    return {"fixes": tidy.find(rows)}


@router.post("/api/list/tidy/apply")
async def list_tidy_apply(req: Request):
    """Apply chosen fixes (from /api/list/tidy). Returns `undo`: the
    flags the fixes changed, to put back with /api/list/tidy/undo."""
    body = await _json_obj(req)
    fixes = body.get("fixes")
    if not isinstance(fixes, list) or not fixes:
        raise HTTPException(400, "fixes is required")
    rows = {i["item_id"]: i for i in state.derived()["smart_list"]["items"] if i.get("on_list")}
    old = state.flags()
    undo, applied = {}, 0

    def snap(i):
        if i not in undo:
            undo[i] = dict(old[i]) if i in old else None

    for f in fixes[:200]:
        if not isinstance(f, dict):
            continue
        kind = f.get("kind")
        if kind == "double" and f.get("keep") in rows:
            drops = [d for d in (f.get("drop") or []) if d in rows]
            total = int(rows[f["keep"]].get("qty") or 1) + sum(int(rows[d].get("qty") or 1) for d in drops)
            snap(f["keep"])
            _merge_flag(f["keep"], {"qty_override": min(total, 99)})
            for d in drops:
                snap(d)
                _merge_flag(d, {"manual": False, "dismissed_on": state.cycle()})
            applied += 1
        elif kind == "amount" and f.get("id") in rows and str(f["id"]).startswith("manual-"):
            name = " ".join(str(f.get("new_name") or "").split())[:80]
            qty = max(1, min(int(f.get("qty") or 1), 99))
            if name:
                snap(f["id"])
                _merge_flag(f["id"], {"name": name, "qty_override": qty})
                applied += 1
        elif kind == "errand" and f.get("id") in rows:
            snap(f["id"])
            _merge_flag(f["id"], {"manual": False, "dismissed_on": state.cycle()})
            applied += 1
    return {"applied": applied, "undo": undo}


@router.post("/api/list/tidy/undo")
async def list_tidy_undo(req: Request):
    body = await _json_obj(req)
    undo = body.get("undo")
    if not isinstance(undo, dict) or len(undo) > 400:
        raise HTTPException(400, "undo is required")
    for item_id, flag in undo.items():
        state.update_flag(str(item_id), lambda _f, flag=flag: dict(flag) if isinstance(flag, dict) else {})
    return {"ok": True}


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
    if not unknown or not own_key.model_ready():
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
    own_key.need_model()
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
    if read["kind"] == "item":
        # One clear product: offered back as "Add Peach?", not added.
        return {"kind": "item", "item": read["item"],
                "confident": read["confident"], "names": [], "added": 0}
    if read["kind"] == "unclear":
        log.info("input failure: photo unclear (%s)", read.get("reason", ""))
        return {"kind": "unclear", "reason": read.get("reason", ""),
                "names": [], "added": 0}
    # The demo adds too: its writes land in the visitor's sandbox.
    added = [_add_name_to_list(n, list_id=list_id) for n in read["items"]]
    return {"kind": "list", "names": [a["name"] for a in added],
            "added": len(added), "demo": demo}


def _remove_item(item_id, lid=None):
    cur = state.flags().get(item_id, {})
    also = list(cur.get("also") or [])
    if lid and also and (lid in also or lid == cur.get("list")):
        # On more than one list: leaving this one keeps the others.
        def leave(f):
            f = dict(f)
            rest = [a for a in also if a != lid]
            if lid == f.get("list"):
                f["list"] = rest.pop(0)
            f["also"] = rest
            ticks = dict(f.get("checked_in") or {})
            ticks.pop(lid, None)
            f["checked_in"] = ticks
            return f
        state.update_flag(item_id, leave)
        return True
    _merge_flag(item_id, {"manual": False, "dismissed_on": state.cycle()})
    groups.note("removed", item_id)
    return False


@router.post("/api/list/remove")
async def list_remove(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    still_on = await run_in_threadpool(_remove_item, item_id, body.get("list_id"))
    return {"ok": True, "still_on": still_on} if still_on else {"ok": True}


def _set_qty(item_id, body):
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


@router.post("/api/list/qty")
async def list_qty(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    await run_in_threadpool(_set_qty, item_id, body)
    return {"ok": True}


@router.post("/api/list/edit")
async def list_edit(req: Request):
    """Edit one list item in one call (owner, 2026-10-31): name, amount,
    unit and note. Any key may be left out. The name is a display name
    kept on the item's flag; empty is refused. Works the same in the
    demo, where the write lands in the visitor's own overlay."""
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id or not isinstance(item_id, str):
        raise HTTPException(400, "item_id is required")
    fields = {}
    if "name" in body:
        name = body["name"].strip()[:60].strip() if isinstance(body["name"], str) else ""
        if not name:
            raise HTTPException(400, "name cannot be empty")
        fields["name"] = name
    if "note" in body:
        note = body["note"].strip()[:60] if isinstance(body["note"], str) else ""
        fields["note"] = note
    if "qty" in body or "unit" in body:
        await run_in_threadpool(_set_qty, item_id, body)
    if fields:
        await run_in_threadpool(_merge_flag, item_id, fields)
    if fields.get("name"):
        await run_in_threadpool(_teach_if_numbered, item_id, fields["name"])
    return {"ok": True}


def _teach_if_numbered(item_id, name):
    """Renaming an item that only had an item number ("costco-791185")
    teaches that name everywhere, not just on this list row."""
    if state._unreadable(state.names().get(item_id), item_id):
        state.learn_item_name(item_id, name)


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
        # Two branches can share a name (two Trader Joe's), so the picker
        # also keeps which directory stores were chosen. Optional: lists
        # saved before this have names only.
        ids = body.get("store_ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400, "store_ids must be a list")
        keep = []
        for sid in ids:
            sid = str(sid or "").strip()[:80]
            if sid and sid not in keep:
                keep.append(sid)
        if keep or (current and "store_ids" in current):
            out["store_ids"] = keep[:state.MAX_LIST_STORES]
    return out


def _check_list_name_free(rows, name, own_id=None):
    if any(l["id"] != own_id and l["name"].lower() == name.lower() for l in rows):
        raise HTTPException(409, f"you already have a list called {name}")


@router.get("/api/lists")
def lists_get():
    return {"lists": state.named_lists()}


def _create_list(fields):
    import uuid
    rows = state.named_lists()
    if len(rows) >= state.MAX_LISTS:
        raise HTTPException(400, f"{state.MAX_LISTS} lists is the most for now")
    _check_list_name_free(rows, fields["name"])
    row = {"id": "l-" + uuid.uuid4().hex[:8], **fields}
    state.save_named_lists(rows + [row])
    return row


@router.post("/api/lists")
async def lists_create(req: Request):
    body = await _json_obj(req)
    # File writes (and any model call) off the event loop (re-audit #9).
    return await run_in_threadpool(_lists_create, body)


def _lists_create(body):
    return _create_list(_clean_list_fields(body))


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


def _move_item(item_id, list_id, from_list=None):
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")

    def change(f):
        f = dict(f)
        also = [a for a in (f.get("also") or []) if a != list_id]
        if from_list and from_list != f.get("list") and from_list in (f.get("also") or []):
            # Moved out of an extra list: the main list stays, the item
            # swaps this list for the new one.
            also = [a for a in also if a != from_list]
            f["also"] = also if list_id is None or list_id == f.get("list") else also + [list_id]
            return f
        f["list"] = list_id
        f["also"] = also
        return f
    state.update_flag(item_id, change)


@router.post("/api/list/also")
async def list_also(req: Request):
    """Put an item on one more list (on true), or take it off that one
    (on false). Its main list stays where it is."""
    body = await _json_obj(req)
    item_id, list_id = body.get("item_id"), body.get("list_id")
    if not item_id or not list_id:
        raise HTTPException(400, "item_id and list_id are required")
    if not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    _put_also(item_id, list_id, on=body.get("on", True) is not False)
    return {"ok": True}


@router.post("/api/list/move")
async def list_move(req: Request):
    """File an item under a list, or under no list (list_id null)."""
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    await run_in_threadpool(_move_item, item_id, body.get("list_id") or None, body.get("from_list"))
    return {"ok": True}


@router.post("/api/list/aisle")
async def list_aisle(req: Request):
    """Pin an item to a department ("Other" for none), or clear the pin
    (aisle null) so the keyword map decides again. Remembered per
    household, so the next time the item is added it files the same way."""
    from api import aisles
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    aisle = body.get("aisle") or None
    if aisle and aisle not in aisles.AISLES and aisle != "Other":
        raise HTTPException(400, "unknown department")
    _merge_flag(item_id, {"aisle": aisle})
    return {"ok": True}


def _set_checked(item_id, checked, lid=None):
    cur = state.flags().get(item_id, {})
    if lid and lid in (cur.get("also") or []):
        # Ticked on the extra list only: the other list keeps its own tick.
        def change(f):
            f = dict(f)
            t = dict(f.get("checked_in") or {})
            if checked:
                t[lid] = state.cycle()
            else:
                t.pop(lid, None)
            f["checked_in"] = t
            return f
        state.update_flag(item_id, change)
    else:
        _merge_flag(item_id, {"checked_on": state.cycle() if checked else None})
    if checked:
        groups.note("ticked", item_id)


@router.post("/api/list/check")
async def list_check(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    # File writes off the event loop (speed audit #9): the tap's write
    # never holds up the reads around it.
    await run_in_threadpool(_set_checked, body["item_id"], body.get("checked"), body.get("list_id"))
    return {"ok": True}


@router.post("/api/list/check-ok")
async def list_check_ok(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"], {"check_ok": state.cycle()})
    return {"ok": True}


@router.get("/api/list/suggest")
async def list_suggest(q: str = ""):
    """Tiers 1 and 2 of the field's auto-suggest: your names, then the
    shared dictionary. $0, no model. "thin" tells the client whether
    to ask for guesses after a pause."""
    from api.list import suggest
    return await run_in_threadpool(suggest.suggest, q[:200])


@router.post("/api/list/suggest/guess")
async def list_suggest_guess(req: Request):
    """Tier 3: a few cached Spark guesses for a prefix, grocery and
    household items only. Off for the demo, with no key, with
    ARYA_SUGGEST_GUESSES not 1 (the default), over the daily budget or the per-account
    daily cap; every one of those is just no guesses."""
    from api.list import suggest
    body = await _json_obj(req)
    q = str(body.get("q") or "")[:200]
    if _is_demo(req) or not suggest.guess_enabled():
        return {"guesses": []}
    try:
        _budget_guard()
    except HTTPException:
        return {"guesses": []}
    names = await run_in_threadpool(suggest.guess, q, new_client())
    return {"guesses": [{"name": n, "kind": "guess", "tag": ""} for n in names]}
