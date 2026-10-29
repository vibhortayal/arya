"""Google Places — the store picker's source of truth (owner,
2026-10-28: "I shouldn't just be able to type any store's name. It
should have an address, it should have everything. Only pick
stores from an API.").

Server-side proxy for the Places API (New): Autocomplete for the
picker's suggestions, Place Details (Essentials fields only —
formatted address, address components, location, types) once when
a store is first picked. The picked store lands in the shared
directory keyed by its place_id (see stores.upsert_google_store),
so each real store costs exactly one Details call, ever; every
later pick is a local directory hit.

Without GOOGLE_PLACES_API_KEY the endpoints answer
{"provisioned": false} and the picker quietly keeps its local
behavior — the same no-op shape as the second seat (PR #44). All
HTTP is plain urllib from sync code paths: endpoints that call
here are def routes or run in a threadpool, never the event loop.
"""
import json, os, urllib.request, urllib.error

BASE = "https://places.googleapis.com/v1"


class PlacesError(Exception):
    pass


def api_key():
    # Set-but-empty counts as unset (the PR #46 pattern).
    return (os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()


def provisioned():
    return bool(api_key())


def _http_json(url, method="GET", body=None, field_mask=None):
    headers = {"X-Goog-Api-Key": api_key(),
               "Content-Type": "application/json"}
    if field_mask:
        headers["X-Goog-FieldMask"] = field_mask
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise PlacesError(f"Google Places answered HTTP {e.code}")
    except Exception as e:
        raise PlacesError(f"Google Places unreachable: {e}")



# The picker is for grocery shopping: suggestions are stores,
# never streets or addresses (owner, 2026-10-28: typing "14 st"
# suggested 14th Street itself, and filing it failed for want of
# a ZIP). wholesale_store is a real place type but NOT a
# supported autocomplete filter - including it makes Google
# reject the whole request (verified live, 2026-10-28). Costco
# still matches the filter: its types include grocery_store.
GROCERY_TYPES = ["grocery_store", "supermarket",
                 "convenience_store", "department_store"]

def autocomplete(text, session_token=None, lat=None, lng=None):
    """Picker suggestions: [{place_id, name, secondary}] — the
    branch's name and its address line, straight from Google."""
    body = {"input": text, "includedRegionCodes": ["US"],
            "includedPrimaryTypes": GROCERY_TYPES}
    if session_token:
        body["sessionToken"] = session_token
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {
            "center": {"latitude": lat, "longitude": lng},
            "radius": 25000.0}}
    out = _http_json(
        f"{BASE}/places:autocomplete", method="POST", body=body,
        field_mask=("suggestions.placePrediction.placeId,"
                    "suggestions.placePrediction.structuredFormat"))
    rows = []
    for s in out.get("suggestions") or []:
        pred = s.get("placePrediction") or {}
        fmt = pred.get("structuredFormat") or {}
        name = (fmt.get("mainText") or {}).get("text", "").strip()
        secondary = (fmt.get("secondaryText") or {}).get("text", "").strip()
        if pred.get("placeId") and name:
            rows.append({"place_id": pred["placeId"], "name": name,
                         "secondary": secondary})
    return rows


def _component(components, type_name, short=False):
    for c in components or []:
        if type_name in (c.get("types") or []):
            return (c.get("shortText") if short else c.get("longText")) or ""
    return ""


def details(place_id):
    """One store's identity: address parts + coordinates, parsed
    from the Essentials-tier response."""
    out = _http_json(
        f"{BASE}/places/{place_id}",
        field_mask="formattedAddress,addressComponents,location,types")
    comps = out.get("addressComponents") or []
    number = _component(comps, "street_number")
    route = _component(comps, "route")
    street = f"{number} {route}".strip()
    if not street:
        street = (out.get("formattedAddress") or "").split(",")[0].strip()
    loc = out.get("location") or {}
    return {
        "street": street,
        "city": _component(comps, "locality")
                or _component(comps, "sublocality"),
        "state": _component(comps, "administrative_area_level_1",
                            short=True),
        "zip": _component(comps, "postal_code"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "formatted": out.get("formattedAddress") or "",
    }


def pick_store(place_id, name, created_by):
    """Resolve a tapped suggestion into a directory store (created
    on first pick, deduped by place_id forever after) and add it
    to the picker's My Stores. Returns the joined mine row."""
    from api import stores as stores_mod
    det = details(place_id)
    store = stores_mod.upsert_google_store(place_id, name, det,
                                           created_by)
    return stores_mod.add_to_mine(store["id"])
