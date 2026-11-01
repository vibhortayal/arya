"""Owner switches kept in site.json beside the registration toggle
(Ops screen, 2026-10-31). Each is read per request through a 3 second
cache, so a change applies within seconds on every worker and survives
a redeploy.

  ai_paused    True: no paid model call starts (lists, Today, sign-in work)
  demo_live    False: the demo household's live reads are off
  photo_reader "spark", "wonder" or "auto" (Spark first, Wonder only if the checks fail): overrides ARYA_PHOTO_READER

Unset means the environment decides, exactly as before."""
import json
import os
import time

from api import state

_TTL_S = 3.0
_cache = {"at": 0.0, "path": "", "doc": {}}
PHOTO_READERS = ("spark", "wonder", "auto")
SPARK_TIERS = ("contributor", "standard")
REASONING = ("low", "medium", "high")


def _path():
    return os.path.join(state.base_dir(), "site.json")


def _doc():
    p = _path()
    now = time.monotonic()
    if _cache["path"] == p and now - _cache["at"] < _TTL_S:
        return _cache["doc"]
    try:
        with open(p) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    doc = doc if isinstance(doc, dict) else {}
    _cache.update(at=now, path=p, doc=doc)
    return doc


def raw():
    """The whole site.json (3 second cache), for api.settings."""
    return _doc()


def ai_paused():
    return _doc().get("ai_paused") is True


def demo_live():
    return _doc().get("demo_live") is not False


def photo_reader():
    v = _doc().get("photo_reader")
    return v if v in PHOTO_READERS else None


def spark_tier():
    v = _doc().get("spark_tier")
    return v if v in SPARK_TIERS else None


def open_model():
    v = _doc().get("open_model")
    return v.strip() if isinstance(v, str) and v.strip() else None


def reasoning_effort():
    v = _doc().get("reasoning_effort")
    return v if v in REASONING else None


def set_nested(top, key, value):
    """Set or clear doc[top][key] (None clears), then drop the cache."""
    p = _path()
    try:
        with open(p) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    doc = doc if isinstance(doc, dict) else {}
    sub = doc.get(top) if isinstance(doc.get(top), dict) else {}
    if value is None:
        sub.pop(key, None)
    else:
        sub[key] = value
    if sub:
        doc[top] = sub
    else:
        doc.pop(top, None)
    state.write_json_atomic(p, doc)
    _cache["at"] = 0.0


def set_nested_user(top, user, key, value):
    """Set or clear doc[top][user][key] (None clears), then drop the cache."""
    p = _path()
    try:
        with open(p) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    doc = doc if isinstance(doc, dict) else {}
    sub = doc.get(top) if isinstance(doc.get(top), dict) else {}
    mine = sub.get(user) if isinstance(sub.get(user), dict) else {}
    if value is None:
        mine.pop(key, None)
    else:
        mine[key] = value
    if mine:
        sub[user] = mine
    else:
        sub.pop(user, None)
    if sub:
        doc[top] = sub
    else:
        doc.pop(top, None)
    state.write_json_atomic(p, doc)
    _cache["at"] = 0.0


def set_flags(changes):
    """Merge validated changes into site.json and drop the cache.
    Returns the full set of switches."""
    p = _path()
    try:
        with open(p) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    doc = doc if isinstance(doc, dict) else {}
    for k, v in changes.items():
        if v is None:
            doc.pop(k, None)
        else:
            doc[k] = v
    state.write_json_atomic(p, doc)
    _cache["at"] = 0.0
    return {"ai_paused": ai_paused(), "demo_live": demo_live(),
            "photo_reader": photo_reader(), "spark_tier": spark_tier(),
            "open_model": open_model(), "reasoning_effort": reasoning_effort()}
