"""Kroger aisle hint: a live lookup that suggests where an item sits in
a Kroger-family store (Kroger Products API `aisleLocations`).

A suggestion only. Crowd-mapping stays the core; this never writes to a
store map. Nothing from Kroger is stored: the one cache is the OAuth
token (our credential, not Kroger content), and a Kroger response is kept
only when it carries a `Cache-Control: max-age`. Kroger sends none today,
so every lookup is live.

Off unless ARYA_KROGER_AISLES=1 and KROGER_CLIENT_ID / KROGER_CLIENT_SECRET
are set (server side only, never logged). Every failure answers None so the
caller falls back to crowd-mapping. HTTP is plain urllib from sync code.
"""
import base64
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait

BASE = "https://api.kroger.com/v1"
TIMEOUT = 8
WORKERS = 5      # concurrent product lookups per trip
BUDGET_S = 10    # give up on stragglers; the screen just shows no hint

# Brands that share Kroger's catalog (store name contains one of these).
FAMILY = ["kroger", "ralphs", "fred meyer", "harris teeter", "king soopers",
          "smith's", "smiths", "fry's", "frys", "dillons", "qfc",
          "city market", "mariano's", "marianos", "pick 'n save",
          "pick n save", "metro market", "baker's", "bakers",
          "food 4 less", "foods co", "jay c", "pay less", "gerbes",
          "ruler foods"]

_lock = threading.Lock()
_token = {"value": None, "expires": 0.0}
_cache = {}          # url -> (expires_at, json); only for max-age responses
_calls = {"day": None, "n": 0}


def configured():
    return all((os.environ.get(k) or "").strip()
               for k in ("KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET"))


def enabled():
    flag = (os.environ.get("ARYA_KROGER_AISLES") or "").strip().lower()
    return flag in ("1", "true", "yes", "on") and configured()


def is_kroger_family(name):
    n = (name or "").lower()
    return any(b in n for b in FAMILY)


def _daily_cap():
    from api import settings   # Ops value, then ARYA_KROGER_DAILY_CALLS
    return settings.get("kroger_daily_calls")


def _spend_call():
    """Count one outbound call against the day's cap (Kroger's quota is
    shared by every user of this app). False once the cap is used."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        if _calls["day"] != today:
            _calls["day"], _calls["n"] = today, 0
        if _calls["n"] >= _daily_cap():
            return False
        _calls["n"] += 1
        return True


def _max_age(headers):
    m = re.search(r"max-age=(\d+)", headers.get("Cache-Control") or "")
    return int(m.group(1)) if m else 0


def _http(url, headers, data=None):
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.headers


def _bearer():
    with _lock:
        if _token["value"] and time.time() < _token["expires"]:
            return _token["value"]
    if not _spend_call():
        return None
    basic = base64.b64encode("{}:{}".format(
        os.environ["KROGER_CLIENT_ID"].strip(),
        os.environ["KROGER_CLIENT_SECRET"].strip()).encode()).decode()
    body, _ = _http(
        BASE + "/connect/oauth2/token",
        {"Authorization": "Basic " + basic,
         "Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode({"grant_type": "client_credentials",
                                "scope": "product.compact"}).encode())
    with _lock:
        _token["value"] = body["access_token"]
        _token["expires"] = time.time() + max(int(body.get("expires_in", 0)) - 60, 0)
        return _token["value"]


def _get(path, params):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    with _lock:
        hit = _cache.get(url)
        if hit and hit[0] > time.time():
            return hit[1]
    token = _bearer()
    if token is None or not _spend_call():
        return None
    body, headers = _http(url, {"Authorization": "Bearer " + token})
    ttl = _max_age(headers)
    if ttl > 0:
        with _lock:
            _cache[url] = (time.time() + ttl, body)
    return body


def _km(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2 + math.cos(a_lat * p)
         * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def _same_store(store, loc):
    """True when Kroger's location is the store the shopper picked: same
    ZIP, or within 0.5 km when both have coordinates."""
    geo = loc.get("geolocation") or {}
    try:
        if store.get("lat") is not None and geo.get("latitude") is not None:
            return _km(float(store["lat"]), float(store["lng"]),
                       float(geo["latitude"]), float(geo["longitude"])) <= 0.5
    except (TypeError, ValueError):
        pass
    zip5 = ((loc.get("address") or {}).get("zipCode") or "")[:5]
    return bool(zip5) and zip5 == (store.get("zip") or "")[:5]


def location_id(store):
    params = {"filter.limit": 10}
    if store.get("lat") is not None and store.get("lng") is not None:
        params["filter.latLong.near"] = "{},{}".format(store["lat"], store["lng"])
    elif store.get("zip"):
        params["filter.zipCode.near"] = store["zip"]
    else:
        return None
    body = _get("/locations", params)
    for loc in (body or {}).get("data", []):
        if _same_store(store, loc):
            return loc.get("locationId")
    return None


def _clean(entry):
    num = str(entry.get("number") or "").strip()
    out = {"department": entry.get("description") or ""}
    # Fresh departments carry a department code, not a walkable aisle.
    if num.isdigit() and 0 < int(num) < 100:
        out["aisle"] = num
    for key, name in (("side", "side"), ("bayNumber", "bay"),
                      ("shelfNumber", "shelf")):
        if entry.get(key):
            out[name] = str(entry[key])
    return out if (out["department"] or "aisle" in out) else None


def _hint_at(loc, item):
    body = _get("/products", {"filter.term": item, "filter.locationId": loc,
                              "filter.limit": 5})
    for prod in (body or {}).get("data", []):
        for entry in prod.get("aisleLocations") or []:
            hint = _clean(entry)
            if hint:
                return {"product": prod.get("description", ""), **hint}
    return None


def trip_hints(store, items, limit=15):
    """{item: hint} for the items of one trip: one location lookup, then the
    items looked up concurrently.
    The caller keeps it in memory for the trip and drops it at checkout;
    nothing is stored here. Items without a hint are left out. Any failure
    returns what was gathered so far (possibly {})."""
    names = []
    for item in items or []:
        n = (item or "").strip()[:80]
        if n and n.lower() not in [x.lower() for x in names]:
            names.append(n)
    out = {}
    if not (enabled() and names and is_kroger_family(store.get("name"))):
        return out
    try:
        loc = location_id(store)
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        return out
    if not loc:
        return out

    def one(n):
        try:
            return n, _hint_at(loc, n)
        except (urllib.error.URLError, OSError, ValueError, KeyError):
            return n, None

    # Concurrent lookups: the token is already warm from the location call.
    pool = ThreadPoolExecutor(max_workers=WORKERS)
    try:
        futures = [pool.submit(one, n) for n in names[:limit]]
        done, _ = wait(futures, timeout=BUDGET_S)
        for f in done:
            n, hint = f.result()
            if hint:
                out[n] = hint
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out


def aisle_hint(store, item):
    """One item's hint at one Kroger-family store, or None."""
    return trip_hints(store, [item], limit=1).get((item or "").strip()[:80])
