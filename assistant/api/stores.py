"""Stores — the store directory and My Stores (Stage E).
Two planes, per the architecture split (DISCUSSION entry 29):
the directory is PLATFORM-level — one shared file in the data root
(stores.json), visible to every account; My Stores + favorites are
ACCOUNT-level — one file per account (my_stores.json) holding only
store ids and the favorite flag.
All logic here is deterministic code — no model calls, $0.
"""
import hashlib, re, secrets
from datetime import datetime

from api import state

SCENES = ("cloud", "strip")

# Seeded directory rows are demo data: real Chino Hills stores the
# demo household shops, with plausible addresses. They are marked
# created_by="seed" and are added idempotently — a seed that is
# already in the directory is never duplicated or overwritten.
SEED_STORES = [
    {"id": "seed-trader-joes-91709", "name": "Trader Joe's",
     "street": "13911 Peyton Dr", "city": "Chino Hills", "state": "CA",
     "zip": "91709", "scene": "cloud", "created_by": "seed"},
    {"id": "seed-costco-91709", "name": "Costco Wholesale",
     "street": "13111 Peyton Dr", "city": "Chino Hills", "state": "CA",
     "zip": "91709", "scene": "strip", "created_by": "seed"},
    {"id": "seed-sprouts-91709", "name": "Sprouts Farmers Market",
     "street": "13953 Peyton Dr", "city": "Chino Hills", "state": "CA",
     "zip": "91709", "scene": "strip", "created_by": "seed"},
    {"id": "seed-los-serranos-91709", "name": "Los Serranos Market",
     "street": "4200 Chino Hills Pkwy", "city": "Chino Hills",
     "state": "CA", "zip": "91709", "scene": "strip",
     "created_by": "seed"},
]
# A fresh account's My Stores starts with the seeds; these two are
# starred (the wireframe's Favorites: Trader Joe's and Costco).
_SEED_FAVORITES = {"seed-trader-joes-91709", "seed-costco-91709"}
# Demo Town's version of the same: the household's usual stores.
_TOWN_FAVORITES = {"Trader Jill's", "Costcozy"}


def _now():
    return datetime.now().isoformat(timespec="seconds")


# --- platform plane: the directory -------------------------------------
# state._load/_save follow the per-user context; the directory lives
# in the data root, so reads and writes run with the context cleared
# (the same pattern demo_guard._is_demo uses to read the session store).

def _root_load(name, default):
    tok = state._current_user.set(None)
    try:
        return state._load(name, default)
    finally:
        state._current_user.reset(tok)


def _root_save(name, obj):
    tok = state._current_user.set(None)
    try:
        state._save(name, obj)
    finally:
        state._current_user.reset(tok)


def _town_rows():
    """Demo Town (ARYA_DEMO_TOWN=1, demo visitor only): the simulated
    town's stores stand in for the whole directory, so the demo's store
    pickers name Trader Jill's and Safeday, never a real store or a
    store a real account added (retest 2026-10-31 #3). None otherwise."""
    from api import town
    if not town.active():
        return None
    return [{"id": "town-" + re.sub(r"[^a-z0-9]+", "-", s["name"].lower()).strip("-"),
             "name": s["name"], "street": "", "city": "Demo Town (simulated)",
             "state": "", "zip": "", "scene": "strip", "created_by": "town"}
            for s in sorted(town.pack()["stores"], key=lambda s: s.get("near", 99))]


def directory():
    """All directory stores, seeds ensured. Returns a list of store
    dicts: id, name, street, city, state, zip, scene, created_by.
    The demo in Demo Town sees the town's stores only (_town_rows)."""
    rows = _town_rows()
    if rows is not None:
        return rows
    data = _root_load("stores.json", None)
    stores = list(data.get("stores", [])) if data else []
    have = {s["id"] for s in stores}
    changed = data is None
    for seed in SEED_STORES:
        if seed["id"] not in have:
            stores.append(dict(seed))
            changed = True
    if changed:
        _root_save("stores.json", {"stores": stores})
    return stores


def get_store(store_id):
    for s in directory():
        if s["id"] == store_id:
            return s
    return None


def address_line(store):
    return f"{store['street']}, {store['city']}, {store['state']} {store['zip']}"


def snapshot(store_id):
    """The fields a session snapshots when it starts from the
    directory: the display name stays the session's store string."""
    s = get_store(store_id)
    if s is None:
        return None
    return {"name": s["name"], "address": address_line(s)}


_MISSED = set()   # merchants Places could not place this run; ask once


def resolve_merchants(merchants):
    """Receipt merchants -> directory stores through Google Places
    (owner, 2026-10-30: a receipt filed with no shopping trip behind
    it should get its exact store name and city). A merchant counts
    when it names a chain and a place ("Costco Newark #1660") and no
    directory store matches it yet. The first Places suggestion is
    taken only if its chain matches and Google's city appears in the
    merchant text, and, when the account's own stores show a state,
    the state matches. The store lands in the directory, not in My
    Stores. Never raises; a miss leaves the receipt on text cleanup."""
    from api import places, storename
    if not places.provisioned():
        return []
    mine_states = [s.get("state") for s in mine() if s.get("state")]
    hint = max(set(mine_states), key=mine_states.count) if mine_states else None
    out = []
    for merchant in dict.fromkeys(m for m in merchants if m):
        words, _num = storename._parse(merchant)
        if merchant in _MISSED or len(words) < 2 \
                or storename._match(words, directory()):
            continue
        place = " ".join(words[1:]).lower()
        try:
            rows = places.autocomplete(" ".join(words + ([hint] if hint else [])))
            row = rows[0] if rows else None
            if not row or storename._chain(row["name"].split()[0]) != storename._chain(words[0]):
                raise LookupError("no store of that chain")
            det = places.details(row["place_id"])
            if (det.get("city") or "").lower() not in place \
                    or (hint and (det.get("state") or "").upper() != hint):
                raise LookupError("not the place the receipt names")
            out.append(upsert_google_store(row["place_id"], row["name"], det, "receipt"))
        except Exception:
            _MISSED.add(merchant)
    return out


def _zip5(zipcode):
    digits = re.sub(r"\D", "", zipcode or "")
    return digits[:5] if len(digits) >= 5 else None


def _dedupe_key(name, zip5):
    return (state._norm_name(name), zip5)


def create_store(name, street, city, state_name, zipcode, created_by):
    """Add a store to the directory (scene: strip — a new store has
    no model until it is mapped). Dedupes on normalized (name, zip):
    an existing match is returned instead of a second row.
    Returns (store, created_flag)."""
    name = (name or "").strip()
    street = (street or "").strip()
    city = (city or "").strip()
    state_name = (state_name or "").strip().upper()
    zip5 = _zip5(zipcode)
    if not name or not street or not city or not state_name:
        raise ValueError("name, street, city, and state are required")
    if zip5 is None:
        raise ValueError("a 5-digit ZIP is required")
    stores = directory()
    key = _dedupe_key(name, zip5)
    for s in stores:
        if _dedupe_key(s["name"], s["zip"]) == key:
            return s, False
    sid = "store-" + hashlib.sha1(
        f"{key[0]}|{zip5}|{secrets.token_hex(4)}".encode()).hexdigest()[:10]
    store = {"id": sid, "name": name, "street": street, "city": city,
             "state": state_name, "zip": zip5, "scene": "strip",
             "created_by": created_by or "unknown"}
    stores.append(store)
    _root_save("stores.json", {"stores": stores})
    return store, True


def upsert_google_store(place_id, name, det, created_by):
    """A store picked from Google Places (owner, 2026-10-28: stores
    are picked from the API, never typed). Identity is the
    place_id: the first pick creates the directory row, every
    later pick returns it — one real store, one row, forever.
    det is places.details(): street/city/state/zip/lat/lng."""
    name = (name or "").strip()
    zip5 = _zip5(det.get("zip"))
    if not place_id or not name:
        raise ValueError("a Google place id and name are required")
    if zip5 is None:
        raise ValueError("that listing has no ZIP Arya can file")
    stores = directory()
    for s in stores:
        if s.get("place_id") == place_id:
            return s
    sid = "gplace-" + hashlib.sha1(place_id.encode()).hexdigest()[:12]
    store = {"id": sid, "place_id": place_id, "name": name,
             "street": (det.get("street") or "").strip(),
             "city": (det.get("city") or "").strip(),
             "state": (det.get("state") or "").strip().upper(),
             "zip": zip5, "lat": det.get("lat"), "lng": det.get("lng"),
             "scene": "strip", "source": "google",
             "created_by": created_by or "unknown"}
    if not store["street"] or not store["city"] or not store["state"]:
        raise ValueError("that listing is missing address parts")
    stores.append(store)
    _root_save("stores.json", {"stores": stores})
    return store


def _haystack(s):
    return state._norm_name(" ".join(
        str(s.get(k) or "") for k in ("name", "street", "city", "state", "zip")))


def search(query, quests_only=False):
    """Case-insensitive directory search. A digit query matches the
    ZIP by prefix (a full 5-digit ZIP therefore matches exactly or
    by prefix); any other query is a substring match on the
    normalized name, street, and city. quests_only keeps stores
    with a 3D model (scene "cloud") — the "With quests" filter."""
    q = (query or "").strip()
    stores = directory()
    if q:
        if q.isdigit():
            stores = [s for s in stores if s["zip"].startswith(q)]
        else:
            # Every word of the query must appear somewhere in the
            # store's name + address, so a full address ("4455 W
            # Armitage Ave, Chicago, IL 60639") finds the store whose
            # street, city, state and ZIP are stored in separate parts.
            tokens = state._norm_name(q).split()
            stores = [s for s in stores
                      if all(t in _haystack(s) for t in tokens)]
    if quests_only:
        stores = [s for s in stores if s["scene"] == "cloud"]
    return sorted(stores, key=lambda s: s["name"].lower())


# --- account plane: My Stores + favorites -------------------------------

def _mine_entries():
    """The account's store entries [{store_id, favorite, added_at}].
    First access initializes the file with the seed stores (Trader
    Joe's and Costco starred) so a new account starts with the
    stores its household already shops."""
    entries = state._load("my_stores.json", None)
    town = _town_rows()
    if town is not None and (entries is None or not any(e["store_id"].startswith("town-") for e in entries["entries"])):
        # Demo Town: the household's stores, nearest first; its two usual stores starred.
        entries = {"entries": [{"store_id": r["id"], "favorite": r["name"] in _TOWN_FAVORITES, "added_at": _now()} for r in town[:4]]}
        state._save("my_stores.json", entries)
    if entries is None:
        entries = {"entries": [
            {"store_id": s["id"],
             "favorite": s["id"] in _SEED_FAVORITES,
             "added_at": _now()}
            for s in SEED_STORES]}
        state._save("my_stores.json", entries)
    return entries["entries"]


def _save_mine(entries):
    state._save("my_stores.json", {"entries": entries})


def mine_ids():
    return {e["store_id"] for e in _mine_entries()}


def mine():
    """The account's stores joined with the directory: directory
    fields + favorite + in_mine. Favorites first, then name order."""
    by_id = {s["id"]: s for s in directory()}
    rows = []
    for e in _mine_entries():
        s = by_id.get(e["store_id"])
        if s is None:
            continue  # a directory row that is gone; nothing to show
        rows.append({**s, "favorite": bool(e.get("favorite")),
                     "in_mine": True})
    rows.sort(key=lambda r: (not r["favorite"], r["name"].lower()))
    return rows


def view(store, entries=None):
    """One directory store as the API returns it: its fields plus
    this account's in_mine / favorite flags."""
    if entries is None:
        entries = _mine_entries()
    mine_by_id = {e["store_id"]: e for e in entries}
    e = mine_by_id.get(store["id"])
    return {**store, "in_mine": e is not None,
            "favorite": bool(e.get("favorite")) if e else False}


def search_views(query, quests_only=False):
    """Search results as the API returns them (see view())."""
    entries = _mine_entries()
    return [view(s, entries) for s in search(query, quests_only)]


def add_to_mine(store_id):
    """Add a directory store to the account's stores. Idempotent.
    Returns the joined row, or None for an unknown store."""
    store = get_store(store_id)
    if store is None:
        return None
    entries = _mine_entries()
    if store_id not in {e["store_id"] for e in entries}:
        entries.append({"store_id": store_id, "favorite": False,
                        "added_at": _now()})
        _save_mine(entries)
    return view(store, entries)


def remove_from_mine(store_id):
    """Take a store out of the account's stores (Tranche 1). The
    directory row is platform data and stays; only the account's
    entry goes. Returns True when an entry was removed."""
    entries = _mine_entries()
    kept = [e for e in entries if e["store_id"] != store_id]
    if len(kept) == len(entries):
        return False
    _save_mine(kept)
    return True


def set_favorite(store_id, favorite):
    """Star or unstar a store in the account's stores. The store
    must be in My Stores — starring is an account-plane act on an
    account-plane row. Returns the joined row, or None."""
    entries = _mine_entries()
    for e in entries:
        if e["store_id"] == store_id:
            e["favorite"] = bool(favorite)
            _save_mine(entries)
            store = get_store(store_id)
            return view(store, entries) if store else None
    return None
