"""Quest Build: a few answers -> a whole store, and the player's saved maps.

The game makes a store from the answers on its own (web/src/game/map/
answers.ts) and sends it here as `base`. One Spark structured-output
call adapts it: names zones for a cuisine, fills in example items,
reads the "anything else" sentence. A second call ("change") applies
one edit said in a sentence. Whatever the model answers is checked
against the same rules as the game's problems(); an answer that breaks
them is dropped and the base store stands.

Contract:
- No key, over budget, a failed call or a bad graph: the base comes
  back unchanged (build) or with a gentle reply (change). Nothing raises.
- Saved maps are per account (quest_maps.json), at most MAX_MAPS,
  keyed "store:<store id>" (My map for a real store) or
  "dream:<slug>" (a dream store). Newest wins on the same key.
- Personal data rule: Standard mode only.
"""
import re
import time

from api import state

MAPS = "quest_maps.json"
MAX_MAPS = 20
MAX_ZONES = 24
LOOKS = ("market", "modern", "farm", "neon")
KINDS = ("produce", "bakery", "deli", "meat", "dairy", "frozen", "aisle")
BANDS = ("left", "back", "right", "centre", "front")
BAND_MAX = {"centre": 10, "back": 7, "left": 4, "right": 4, "front": 3}
SOURCES = ("template", "community", "mine", "dream")

ZONE_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"}, "kind": {"type": "string", "enum": list(KINDS)},
        "label": {"type": "string"}, "short": {"type": "string"},
        "band": {"type": "string", "enum": list(BANDS)}, "index": {"type": "integer"},
        "size": {"type": "string", "enum": ["s", "m", "l"]},
        "categories": {"type": "array", "items": {"type": "string"}}},
    "required": ["id", "kind", "label", "band", "index"]}

BUILD_SCHEMA = ("quest_store", {
    "type": "object",
    "properties": {"zones": {"type": "array", "items": ZONE_SCHEMA}, "say": {"type": "string"}},
    "required": ["zones"]})

RULES = """A store is a list of zones. Each zone has:
- id: lowercase letters, digits and dashes, unique, at most 32 characters
- kind: one of produce, bakery, deli, meat, dairy, frozen, aisle
- label: what the sign says, at most 48 characters. Centre aisles are
  "Aisle N · Topic", numbered from 1 in index order.
- short: optional short sign text, at most 14 characters
- band: where it sits. left wall, back wall, right wall, centre aisles,
  or front (low tables by the doors). At most 10 centre, 7 back, 4 left,
  4 right, 3 front.
- index: order along its band, from 0 (nearest the doors on side walls)
- size: s, m or l (relative)
- categories: 4 to 12 lowercase example items found there
Fresh food sits around the walls, cold cases (dairy, frozen) are usually
along the back or right wall. Keep it a store a child could walk."""

BUILD_PROMPT = """You are designing a pretend grocery store for a game.
{rules}

The player answered:
- Store type: {type}{cuisine}
- Make big: {focus}
- Anything else: {extra}

Here is a starting store that already follows the rules:
{zones}

Adapt it to the answers: rename zones and fill categories with real
items a shopper of this kind of store buys (for a cuisine, that
cuisine's staples), add or grow zones for what they asked for, and
follow the "anything else" sentence if it fits the rules. Keep between
5 and 16 zones. Answer JSON {{"zones": [...], "say": "<one short friendly
sentence about the store>"}}."""

CHANGE_PROMPT = """You are changing a pretend grocery store in a game.
{rules}

The store now:
{zones}

The player said: "{say}"

Apply that one change and keep everything else as it is. If it cannot be
done within the rules, return the store unchanged. Answer JSON
{{"zones": [...], "say": "<one short sentence saying what you changed, or
why you could not>"}}."""


def _str(v, n):
    return str(v or "").strip()[:n]


def problems(g):
    """The game's problems() (web/src/game/map/graph.ts), for model output and saved maps."""
    out = []
    zones = g.get("zones") if isinstance(g, dict) else None
    if not isinstance(zones, list) or not zones:
        return ["no zones"]
    if len(zones) > MAX_ZONES:
        out.append("more than 24 zones")
    if g.get("look") and g.get("look") not in LOOKS:
        out.append("unknown look")
    ids, per = set(), {}
    for z in zones:
        if not isinstance(z, dict):
            out.append("zone is not an object")
            continue
        zid = z.get("id")
        if not isinstance(zid, str) or not re.fullmatch(r"[a-z0-9-]{1,32}", zid):
            out.append(f"bad id {zid!r}")
        elif zid in ids:
            out.append(f"duplicate id {zid}")
        ids.add(zid)
        if z.get("kind") not in KINDS:
            out.append(f"{zid}: unknown kind")
        if z.get("band") not in BANDS:
            out.append(f"{zid}: unknown band")
        label = z.get("label")
        if not isinstance(label, str) or not label or len(label) > 48:
            out.append(f"{zid}: label missing or too long")
        if z.get("size") not in (None, "s", "m", "l"):
            out.append(f"{zid}: bad size")
        if not isinstance(z.get("index"), int) or isinstance(z.get("index"), bool):
            out.append(f"{zid}: bad index")
        per[z.get("band")] = per.get(z.get("band"), 0) + 1
    for b, n in BAND_MAX.items():
        if per.get(b, 0) > n:
            out.append(f"too many zones in {b}")
    return out


def clean_graph(g):
    """A graph trimmed to the fields the game reads, or None if it breaks the rules."""
    if not isinstance(g, dict):
        return None
    zones = []
    for z in (g.get("zones") or [])[:MAX_ZONES + 1] if isinstance(g.get("zones"), list) else []:
        if not isinstance(z, dict):
            return None
        c = {"id": _str(z.get("id"), 40).lower(), "kind": z.get("kind"), "label": _str(z.get("label"), 60),
             "band": z.get("band"), "index": z.get("index")}
        if z.get("short"):
            c["short"] = _str(z.get("short"), 14)
        if z.get("size") is not None:
            c["size"] = z.get("size")
        cats = z.get("categories")
        if isinstance(cats, list):
            c["categories"] = [_str(w, 32).lower() for w in cats[:16] if isinstance(w, str) and w.strip()]
        zones.append(c)
    out = {"id": re.sub(r"[^a-z0-9:-]", "", _str(g.get("id"), 48).lower()) or "build",
           "source": g.get("source") if g.get("source") in SOURCES else "dream", "zones": zones}
    if g.get("size") in ("s", "m", "l"):
        out["size"] = g["size"]
    if g.get("look"):
        out["look"] = g.get("look")
    if g.get("name"):
        out["name"] = _str(g.get("name"), 40)
    return None if problems(out) else out


def _zone_lines(g):
    return "\n".join(
        f"- {z['id']} ({z['kind']}, {z['band']} #{z['index']}{', ' + z['size'] if z.get('size') else ''}): {z['label']}"
        + (f" [{', '.join(z.get('categories') or [])}]" if z.get("categories") else "")
        for z in g["zones"])


def _ask(client, prompt, cache_key):
    from api.meta_client import parse_json
    text, _usage, _cost = client.chat([{"role": "user", "content": prompt}], mode="standard", personal=True,
                                      reasoning_effort="low", temperature=0.4, schema=BUILD_SCHEMA,
                                      cache_key=cache_key)
    return parse_json(text) or {}


def _merge(base, zones):
    """The model's zones on the base graph's frame (id, source, size, look, name)."""
    return clean_graph({**base, "zones": zones})


def build(client, answers, base):
    """(graph, say). The base (already cleaned) when the model cannot do better."""
    base = clean_graph(base)
    if base is None:
        return None, ""
    a = answers if isinstance(answers, dict) else {}
    if not getattr(client, "api_key", ""):
        return base, ""
    focus = [f for f in (a.get("focus") or []) if isinstance(f, str)][:6]
    msg = BUILD_PROMPT.format(
        rules=RULES, type=_str(a.get("type"), 24) or "supermarket",
        cuisine=f" ({_str(a.get('cuisine'), 40)})" if a.get("cuisine") else "",
        focus=", ".join(focus) or "nothing in particular",
        extra=_str(a.get("extra"), 200) or "nothing", zones=_zone_lines(base))
    try:
        got = _ask(client, msg, "quest-build-v1")
    except Exception:  # the answers' own store stands
        return base, ""
    g = _merge(base, got.get("zones"))
    return (g, _str(got.get("say"), 160)) if g else (base, "")


def change(client, graph, say):
    """(graph, reply). The same graph and a gentle reply when it cannot change it."""
    g = clean_graph(graph)
    if g is None:
        return None, ""
    said = _str(say, 200)
    if not said:
        return g, "Say what to change, like: move frozen to the back wall."
    if not getattr(client, "api_key", ""):
        return g, "Arya can't change stores right now. Try again in a bit."
    try:
        got = _ask(client, CHANGE_PROMPT.format(rules=RULES, zones=_zone_lines(g), say=said), "quest-change-v1")
    except Exception:
        return g, "That didn't work this time. Try saying it another way."
    new = _merge(g, got.get("zones"))
    if not new:
        return g, "I couldn't fit that in this store. Try something smaller."
    return new, _str(got.get("say"), 160) or "Done."


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:32] or "store"


def list_maps():
    maps = state._load(MAPS, [])
    return maps if isinstance(maps, list) else []


def save_map(m):
    """Saves one map; returns it with its key and time, or None if it is not a valid map."""
    if not isinstance(m, dict):
        return None
    kind = m.get("kind") if m.get("kind") in ("store", "dream") else None
    name = _str(m.get("name"), 40)
    g = clean_graph(m.get("graph"))
    if not kind or not name or g is None:
        return None
    store_id = _str(m.get("storeId"), 64) if kind == "store" else None
    if kind == "store" and not store_id:
        return None
    key = f"store:{store_id}" if kind == "store" else f"dream:{_slug(name)}"
    row = {"key": key, "kind": kind, "name": name, "graph": g, "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if store_id:
        row["storeId"] = store_id
    maps = [x for x in list_maps() if isinstance(x, dict) and x.get("key") != key]
    maps = [row] + maps
    state._save(MAPS, maps[:MAX_MAPS])
    return row
