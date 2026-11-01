"""Shelf life from Meta Spark, for "Still good?" (owner, 2026-11-01: "I
want this intelligence to be built in Arya using the Meta models").

Spark reads each fresh-looking item's name once and says how many days it
usually stays good at home (null for things that keep for months). The
answer is cached per item in shelf_life.json; only items bought in the
last CHECK_MAX_DAYS are ever sent, so an upload of old receipts costs
nothing. Without a key, or when Spark has not answered yet, the keyword
table in api/eyes/service.py stands in. The window and the cap on how
many to ask stay in deterministic code (eyes.service.should_check).

Personal data: Spark Standard only (MODEL-POLICY): item names, no dates
or prices."""
import json
import os

from api import state
from api.eyes.service import CHECK_MAX_DAYS, prior_days

_PROMPT = open(os.path.join(os.path.dirname(__file__), "prompts", "shelf_life_v1.md")).read()
SCHEMA = ("ShelfLife", {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"item_id": {"type": "string"},
                       "shelf_days": {"type": ["integer", "null"]}},
        "required": ["item_id"]}}},
    "required": ["items"]})
FILE = "shelf_life.json"
MAX_DAYS = 60  # an answer above this is not a "still good?" item


def known():
    return state._load(FILE, {})


def shelf_days(item_id, name, cache=None):
    """Days an item usually keeps at home: Spark's answer when there is
    one (None means "keeps for months, do not ask"), else the keyword
    table."""
    cache = known() if cache is None else cache
    if "days" in cache.get(item_id, {}):
        return cache[item_id]["days"]
    return prior_days(name)  # no answer yet, or Spark gave none for it


def ask_batch(client, items):
    """items: [(item_id, name)] -> {item_id: days or None}."""
    listing = "\n".join(f"[{iid}] {name}" for iid, name in items)
    text, _u, _c = client.chat(
        [{"role": "system", "content": _PROMPT},
         {"role": "user", "content": listing}],
        mode="standard", personal=True, reasoning_effort="low",
        schema=SCHEMA, cache_key="arya-shelf-life-v1")
    start, end = text.find("{"), text.rfind("}")
    if start < 0:
        return {}
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    want = {iid for iid, _ in items}
    out = {}
    for v in data.get("items", []):
        iid = v.get("item_id")
        if iid not in want:
            continue
        d = v.get("shelf_days")
        out[iid] = d if isinstance(d, int) and 1 <= d <= MAX_DAYS else None
    return out


def pending(client, limit=50):
    """Ask Spark about items bought in the last CHECK_MAX_DAYS that have
    no answer yet. Returns how many were answered. Never raises."""
    if not getattr(client, "api_key", ""):
        return 0
    try:
        from datetime import date
        d = state.derived()
        today = date.fromisoformat(state.today_ref())
        cache = known()
        nm = state.readable_names()
        todo = []
        for p in d["patterns"]:
            iid = p["item_id"]
            if iid in cache or iid not in nm or not p.get("last_bought"):
                continue
            if (today - date.fromisoformat(p["last_bought"][:10])).days <= CHECK_MAX_DAYS:
                todo.append((iid, nm[iid]))
        done, asked = {}, []
        for i in range(0, min(len(todo), limit), 25):
            batch = todo[i:i + 25]
            done.update(ask_batch(client, batch))
            asked += [iid for iid, _ in batch]
    except Exception:
        return 0
    if asked:
        # An item Spark skipped is marked asked, not re-sent on every
        # receipt; it keeps the keyword table's answer.
        with state.file_lock(FILE):
            fresh = known()
            for iid in asked:
                fresh[iid] = {"days": done[iid]} if iid in done else {"asked": True}
            state._save(FILE, fresh)
    return len(done)
