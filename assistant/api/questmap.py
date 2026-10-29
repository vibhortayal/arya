"""Quest store maps: which zone of a store each list item belongs in.

The game files most items by words (web/src/game/map/classify.ts). What
the words do not know (tahini, dish brush, cat food) used to land in the
first aisle; here one Spark structured-output call files them into the
store's own zones, and the answer is cached per account by store graph
and item name, so an item is classified once.

Contract:
- Input: item names (at most 60, each at most 80 characters) and the
  store's zones (id, label, a few example words).
- Output: {name: zone_id} for every item it could place, plus where
  each answer came from ("cache" or "model"). An item it could not
  place is left out; the game keeps its word guess.
- No key, over budget, a failed call or an answer with unknown zone
  ids: the known answers still come back, nothing raises.
- Personal data rule: Standard mode only.
"""
import re

from api import state

CACHE = "quest_zones.json"
MAX_ITEMS = 60
MAX_ZONES = 24
MAX_CACHE = 3000

SCHEMA = ("quest_zones", {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"name": {"type": "string"}, "zone": {"type": "string"}},
        "required": ["name", "zone"]}}},
    "required": ["items"]})

PROMPT = """You place grocery list items in a store's zones.
Zones (id: label, example items):
{zones}

For each item below, answer the id of the one zone where a shopper
would find it in this store. Use only the ids above. If nothing fits
well, pick the closest zone. Answer JSON: {{"items": [{{"name": ..., "zone": ...}}]}}
with every item, names exactly as given.

Items:
{items}"""


def norm(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())[:80]


def clean_request(items, zones):
    """The items and zones a request may carry, trimmed to the limits."""
    names, seen = [], set()
    for n in items or []:
        if isinstance(n, str) and norm(n) and norm(n) not in seen:
            seen.add(norm(n))
            names.append(n.strip()[:80])
    zs = []
    for z in (zones or [])[:MAX_ZONES]:
        if not isinstance(z, dict):
            continue
        zid = str(z.get("id") or "")
        if not re.fullmatch(r"[a-z0-9-]{1,32}", zid):
            continue
        words = [str(w)[:24] for w in (z.get("categories") or [])[:8] if isinstance(w, str)]
        zs.append({"id": zid, "label": str(z.get("label") or zid)[:48], "categories": words})
    return names[:MAX_ITEMS], zs


def classify(client, graph_id, items, zones):
    """{name: zone_id} and {name: "cache"|"model"} for the items it could place."""
    names, zs = clean_request(items, zones)
    ids = {z["id"] for z in zs}
    gid = re.sub(r"[^a-z0-9:-]", "", str(graph_id or "template").lower())[:48] or "template"
    cache = state._load(CACHE, {})
    out, src, todo = {}, {}, []
    for n in names:
        hit = cache.get(f"{gid}|{norm(n)}")
        if hit in ids:
            out[n], src[n] = hit, "cache"
        else:
            todo.append(n)
    if not todo or not zs or not getattr(client, "api_key", ""):
        return out, src
    zone_lines = "\n".join(f"- {z['id']}: {z['label']}" + (f" ({', '.join(z['categories'])})" if z["categories"] else "") for z in zs)
    msg = PROMPT.format(zones=zone_lines, items="\n".join(f"- {n}" for n in todo))
    try:
        from api.meta_client import parse_json
        text, _usage, _cost = client.chat([{"role": "user", "content": msg}], mode="standard", personal=True,
                                          reasoning_effort="low", temperature=0, schema=SCHEMA,
                                          cache_key="quest-zones-v1")
        rows = (parse_json(text) or {}).get("items") or []
    except Exception:  # a failed read never blocks a trip: the word guesses stand
        return out, src
    wanted = {norm(n): n for n in todo}
    for r in rows:
        if not isinstance(r, dict):
            continue
        n, z = wanted.get(norm(r.get("name"))), str(r.get("zone") or "")
        if n and z in ids:
            out[n], src[n] = z, "model"
            cache[f"{gid}|{norm(n)}"] = z
    if any(v == "model" for v in src.values()):
        if len(cache) > MAX_CACHE:  # oldest answers go first
            cache = dict(list(cache.items())[-MAX_CACHE:])
        state._save(CACHE, cache)
    return out, src
