"""Owner switches kept in site.json beside the registration toggle
(Ops screen, 2026-10-31). Each is read per request through a 3 second
cache, so a change applies within seconds on every worker and survives
a redeploy.

  ai_paused    True: no paid model call starts (lists, Today, sign-in work)
  demo_live    False: the demo household's live reads are off
  photo_reader "spark" or "wonder": overrides ARYA_PHOTO_READER

Unset means the environment decides, exactly as before."""
import json
import os
import time

from api import state

_TTL_S = 3.0
_cache = {"at": 0.0, "path": "", "doc": {}}
PHOTO_READERS = ("spark", "wonder")


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


def ai_paused():
    return _doc().get("ai_paused") is True


def demo_live():
    return _doc().get("demo_live") is not False


def photo_reader():
    v = _doc().get("photo_reader")
    return v if v in PHOTO_READERS else None


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
            "photo_reader": photo_reader()}
