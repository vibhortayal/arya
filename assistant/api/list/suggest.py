"""Auto-suggest for the list field (owner, 2026-10-30).

Three tiers, shown in this order:
1. Yours: names on your lists and in your receipts. $0.
2. Shared: canonical names from all households' lists, plus the
   built-in grocery words. $0. The shared file holds only
   name -> household count; a name needs MIN_HOUSEHOLDS households.
3. Guesses: one cached Spark call for a thin prefix, scoped to
   grocery and household item names, post-filtered. Never per
   keystroke; the client waits for a pause.
"""
import json, os, re, tempfile, time

from api import state

MIN_QUERY = 2
GUESS_MIN_QUERY = 4
ROWS_PER_TIER = 3
THIN = 3
SHARED_TTL_S = 6 * 3600
CACHE_MAX = 2000
SEED_SKIP = {"freezer", "frozen foods", "dairy", "ice"}

_SHARED = "shared_names.json"
_GUESS_CACHE = "guess_cache.json"
_NAME_OK = re.compile(r"^[A-Za-z][A-Za-z0-9 &'.%-]*$")


def min_households():
    try:
        return max(1, int(os.environ.get("ARYA_SUGGEST_MIN_HOUSEHOLDS", "3")))
    except ValueError:
        return 3


def key(name):
    k = state._norm_name(name)
    return k[:-1] if len(k) > 3 and k.endswith("s") else k


def plausible(name):
    """A name a shared list or a guess may carry: short, plain words,
    no contact details, nothing the grocery check calls non-grocery."""
    from api.list import grocery
    name = (name or "").strip()
    if not 2 <= len(name) <= 40 or not _NAME_OK.match(name):
        return False
    if len(name.split()) > 5 or re.search(r"\d{5,}", name):
        return False
    return grocery.classify(name)["kind"] != "other"


def matches(name, q):
    """Rank 0: the name starts with q. 1: a word starts with every
    query word. None: no match."""
    n, qn = state._norm_name(name), state._norm_name(q)
    if not qn or not n:
        return None
    if n.startswith(qn):
        return 0
    words = n.split()
    if all(any(w.startswith(t) for w in words) for t in qn.split()):
        return 1
    return None


def last_segment(text):
    """The item being typed: the text after the last ; or newline."""
    return re.split(r"[;\n]", text or "")[-1].strip()


# --- tier 1 ---------------------------------------------------------------

def yours(q, derived=None):
    d = derived or state.derived()
    on_list = {state._norm_name(i["name"]) for i in d["smart_list"]["items"]}
    lname = {l["id"]: l["name"] for l in state.named_lists()}
    where = {state._norm_name(i["name"]): lname.get(i.get("list"), "")
             for i in d["smart_list"]["items"] if i.get("on_list")}
    counts = {p["item_id"]: p["purchase_count"] for p in d["patterns"]}
    pool = {}
    for e in state.dictionary()["entries"]:
        if e.get("kind") == "fee":
            continue
        pool[e["canonical_name"]] = max(pool.get(e["canonical_name"], 0), counts.get(e["item_id"], 1))
    for i in d["smart_list"]["items"]:
        pool.setdefault(i["name"], 1)
    rows = []
    for name, n in pool.items():
        r = matches(name, q)
        if r is not None:
            rows.append((r, -n, name))
    rows.sort()
    out = []
    for _, _, nm in rows:
        row = {"name": nm, "kind": "yours",
               "tag": "On this list" if state._norm_name(nm) in on_list else "Bought before"}
        if state._norm_name(nm) in where:
            row["on"] = where[state._norm_name(nm)]   # "" = Everything else
        out.append(row)
    return out


# --- tier 2 ---------------------------------------------------------------

def _shared_path():
    return os.path.join(state.base_dir(), _SHARED)


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "w") as fh:
        json.dump(obj, fh)
    os.replace(tmp, path)


def _households():
    """(household key, plane dir, owner) for each real household once;
    a group is one household. The demo account is never counted."""
    from api import groups
    root = os.path.join(state.base_dir(), "users")
    seen = set()
    for u in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if u == state.DEMO_USER or u.startswith("."):
            continue
        gid = groups.group_id_for(u)
        hk = "g:" + gid if gid else "u:" + u
        if hk in seen:
            continue
        seen.add(hk)
        if gid:
            yield hk, state.group_dir(gid), state.group_owner(gid)
        else:
            yield hk, state.user_dir(u), u


def rebuild_shared():
    """Count the typed list names across households, keep the ones in
    at least MIN_HOUSEHOLDS, and write name -> count. Nothing else is
    stored: no account, group, list name or time per name."""
    seen = {}
    for hk, d, owner in _households():
        try:
            fl = state.load_at(d, owner, "flags.json", {})
        except (OSError, ValueError):
            continue
        for f in fl.values():
            nm = (f.get("name") or "").strip() if isinstance(f, dict) and f.get("manual") else ""
            if nm and plausible(nm):
                ent = seen.setdefault(key(nm), [nm, set()])
                ent[1].add(hk)
    need = min_households()
    names = {nm: len(hh) for nm, hh in seen.values() if len(hh) >= need}
    doc = {"built": int(time.time()), "names": names}
    _write_json(_shared_path(), doc)
    return doc


def shared_names():
    try:
        with open(_shared_path()) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = None
    if not doc or time.time() - doc.get("built", 0) > SHARED_TTL_S:
        doc = rebuild_shared()
    return doc["names"]


def _seed():
    from api import aisles
    out = []
    for phrases in aisles._RULES.values():
        for ph in phrases:
            if ph not in SEED_SKIP and len(ph) > 2:
                out.append(ph.title())
    return out


def shared(q):
    rows = []
    for name, n in shared_names().items():
        r = matches(name, q)
        if r is not None:
            rows.append((r, -n, name))
    for name in _seed():
        r = matches(name, q)
        if r is not None:
            rows.append((r, 0, name))
    rows.sort()
    return [{"name": nm, "kind": "shared", "tag": ""} for _, _, nm in rows]


def suggest(q, derived=None):
    """Tiers 1 and 2, up to ROWS_PER_TIER each, no repeats."""
    q = last_segment(q)
    if len(state._norm_name(q)) < MIN_QUERY:
        return {"q": q, "rows": [], "thin": False}
    out, used = [], set()
    for tier in (yours(q, derived), shared(q)):
        n = 0
        for row in tier:
            k = key(row["name"])
            if k in used:
                continue
            used.add(k)
            out.append(row)
            n += 1
            if n == ROWS_PER_TIER:
                break
    return {"q": q, "rows": out, "thin": len(out) < THIN
            and len(state._norm_name(q)) >= GUESS_MIN_QUERY}


# --- tier 3 ---------------------------------------------------------------

_SYSTEM = (
    "You complete what a shopper has typed into a grocery list. Reply "
    "with up to 4 names of groceries or household supplies (food, drink, "
    "cleaning, paper goods, toiletries, pet food, baby items) that begin "
    "like the text or are close variants of it. Item names only, 1 to 4 "
    "words each, no brands unless the text is a brand, no sizes, no "
    "sentences. If the text is not a grocery or household item, reply "
    "with an empty list. JSON only: {\"names\": [\"...\"]}")


def guess_enabled():
    return os.environ.get("ARYA_SUGGEST_GUESSES", "1") != "0" \
        and bool(os.environ.get("MODEL_API_KEY"))


def _cache_path():
    return os.path.join(state.base_dir(), _GUESS_CACHE)


def _read_cache():
    try:
        with open(_cache_path()) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _daily_cap():
    try:
        return int(os.environ.get("ARYA_SUGGEST_GUESS_CAP", "40"))
    except ValueError:
        return 40


def _spend_one():
    """Count one model call against today's cap; False when spent."""
    today = time.strftime("%Y-%m-%d")
    u = state._load("suggest_guess.json", {})
    if u.get("day") != today:
        u = {"day": today, "n": 0}
    if u["n"] >= _daily_cap():
        return False
    u["n"] += 1
    state._save("suggest_guess.json", u)
    return True


def clean_guesses(names, q):
    """Post-filter: plausible item names only, no repeats, never the
    typed text itself."""
    out, used = [], {key(q)}
    for nm in names if isinstance(names, list) else []:
        if not isinstance(nm, str):
            continue
        nm = nm.strip()
        if plausible(nm) and key(nm) not in used:
            used.add(key(nm))
            out.append(nm)
    return out[:4]


def guess(q, client):
    """Cached model guesses for a prefix. Raises nothing; any failure
    is no guesses. The cache is keyed by the normalized prefix alone."""
    q = last_segment(q)
    k = state._norm_name(q)
    if len(k) < GUESS_MIN_QUERY or len(k) > 30:
        return []
    cache = _read_cache()
    if k in cache:
        return cache[k]
    if not _spend_one():
        return []
    try:
        text, _usage, _cost = client.chat(
            [{"role": "system", "content": _SYSTEM},
             {"role": "user", "content": q}],
            mode="standard", personal=True, reasoning_effort="low",
            cache_key="arya-suggest-v1")
        raw = json.loads(text[text.find("{"): text.rfind("}") + 1]).get("names")
    except Exception:
        return []
    names = clean_guesses(raw, q)
    if len(cache) >= CACHE_MAX:
        cache.pop(next(iter(cache)))
    cache[k] = names
    try:
        _write_json(_cache_path(), cache)
    except OSError:
        pass
    return names
