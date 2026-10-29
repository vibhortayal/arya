"""Google Places store picking (owner, 2026-10-28): a store is
picked from the API — name, address, place_id — never typed into
existence. The HTTP layer is faked; no key, no network."""
import os, tempfile, unittest
from tests.frontend import src

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
os.environ.pop("GOOGLE_PLACES_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402


DETAILS = {
    "formattedAddress": "4455 W Armitage Ave, Chicago, IL 60639, USA",
    "addressComponents": [
        {"longText": "4455", "shortText": "4455", "types": ["street_number"]},
        {"longText": "West Armitage Avenue", "shortText": "W Armitage Ave",
         "types": ["route"]},
        {"longText": "Chicago", "shortText": "Chicago", "types": ["locality"]},
        {"longText": "Illinois", "shortText": "IL",
         "types": ["administrative_area_level_1"]},
        {"longText": "60639", "shortText": "60639", "types": ["postal_code"]},
    ],
    "location": {"latitude": 41.9169, "longitude": -87.7387},
    "types": ["grocery_store"],
}

AUTO = {"suggestions": [{"placePrediction": {
    "placeId": "ChIJ-test-place",
    "structuredFormat": {
        "mainText": {"text": "Trader Joe's"},
        "secondaryText": {"text": "W Armitage Ave, Chicago, IL"}}}}]}


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, *a, **k):
        raise AssertionError("store paths must not call a model")


def make_client(case):
    from api import main
    from api import deps
    deps.MetaClient = FakeClient
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    return case.c


class TestPlacesParsing(unittest.TestCase):
    def test_autocomplete_and_details_shapes(self):
        from api import places
        bodies = []
        def capture(*a, **k):
            bodies.append(k.get("body") or {})
            return AUTO
        places._http_json = capture
        rows = places.autocomplete("trader")
        types = bodies[0].get("includedPrimaryTypes") or []
        self.assertIn("grocery_store", types)
        self.assertIn("supermarket", types)
        self.assertLessEqual(len(types), 5)
        places._http_json = lambda *a, **k: AUTO
        rows = places.autocomplete("trader")
        self.assertEqual(rows, [{"place_id": "ChIJ-test-place",
                                 "name": "Trader Joe's",
                                 "secondary": "W Armitage Ave, Chicago, IL"}])
        places._http_json = lambda *a, **k: DETAILS
        det = places.details("ChIJ-test-place")
        self.assertEqual(det["street"], "4455 West Armitage Avenue")
        self.assertEqual((det["city"], det["state"], det["zip"]),
                         ("Chicago", "IL", "60639"))
        self.assertEqual(det["lat"], 41.9169)


SEARCH = {"places": [
    {"id": "ChIJ-ts-tj", "displayName": {"text": "Trader Joe's"},
     "formattedAddress": "1914 14th St NW, Washington, DC 20009, USA",
     "types": ["grocery_store", "food", "store"]},
    {"id": "ChIJ-ts-pharm", "displayName": {"text": "Corner Pharmacy"},
     "formattedAddress": "1916 14th St NW, Washington, DC 20009, USA",
     "types": ["pharmacy", "store"]}]}


class TestAddressFallback(unittest.TestCase):
    """A bare street address gets a Text Search fallback; a name
    query never does (owner, 2026-10-28)."""

    def run_auto(self, text):
        from api import places
        calls = []
        def fake(url, method="GET", body=None, field_mask=None):
            calls.append(url)
            if url.endswith("places:searchText"):
                return SEARCH
            return {"suggestions": []}
        places._http_json = fake
        return places.autocomplete(text), calls

    def test_address_query_falls_back(self):
        rows, calls = self.run_auto("1914 14th street")
        self.assertEqual(len(calls), 2)
        # Only the grocery store survives the type filter.
        self.assertEqual(rows, [{
            "place_id": "ChIJ-ts-tj", "name": "Trader Joe's",
            "secondary": "1914 14th St NW, Washington, DC 20009, USA"}])

    def test_name_query_never_falls_back(self):
        rows, calls = self.run_auto("zzqq market")
        self.assertEqual(rows, [])
        self.assertEqual(len(calls), 1)


class TestPlacesEndpoints(unittest.TestCase):
    def setUp(self):
        # Fresh data dir per test: /auth/setup is a one-time door.
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        r = self.c.post("/auth/setup",
                        json={"username": "picker@example.com",
                              "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_unprovisioned_is_a_quiet_noop(self):
        r = self.c.get("/api/stores/places?q=trader")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"provisioned": False, "suggestions": []})
        r = self.c.post("/api/stores/places/pick",
                        json={"place_id": "x", "name": "Y"})
        self.assertEqual(r.status_code, 503)

    def test_pick_files_the_store_by_place_id(self):
        os.environ["GOOGLE_PLACES_API_KEY"] = "test-places-key"
        try:
            from api import places
            calls = []
            def fake(url, method="GET", body=None, field_mask=None):
                calls.append(url)
                return AUTO if "autocomplete" in url else DETAILS
            places._http_json = fake
            r = self.c.get("/api/stores/places?q=trader&session=s1")
            self.assertEqual(len(r.json()["suggestions"]), 1)
            row = self.c.post("/api/stores/places/pick", json={
                "place_id": "ChIJ-test-place",
                "name": "Trader Joe's"}).json()
            self.assertEqual(row["name"], "Trader Joe's")
            self.assertEqual(row["zip"], "60639")
            self.assertTrue(row["id"].startswith("gplace-"))
            n_details = len([u for u in calls if "autocomplete" not in u])
            row2 = self.c.post("/api/stores/places/pick", json={
                "place_id": "ChIJ-test-place",
                "name": "Trader Joe's"}).json()
            self.assertEqual(row2["id"], row["id"])
            # Second pick: the directory already holds the place_id,
            # but pick still asks Google once per pick call today —
            # the directory dedupe is what matters: one row.
            mine = self.c.get("/api/stores/mine").json()["stores"]
            self.assertEqual(
                len([m for m in mine if m["id"] == row["id"]]), 1)
            self.assertEqual(n_details, 1)
        finally:
            os.environ.pop("GOOGLE_PLACES_API_KEY", None)

    def test_near_me_lists_stores_around_the_phone(self):
        os.environ["GOOGLE_PLACES_API_KEY"] = "test-places-key"
        try:
            from api import places
            calls = []
            def fake(url, method="GET", body=None, field_mask=None):
                calls.append((url, body))
                return SEARCH
            places._http_json = fake
            r = self.c.get("/api/stores/places?q=&lat=34.1&lng=-117.6")
            self.assertEqual(len(r.json()["suggestions"]), 1)
            self.assertIn("searchText", calls[0][0])
            self.assertEqual(calls[0][1]["textQuery"], "grocery store")
            # No location and no text: still a quiet no-op.
            r = self.c.get("/api/stores/places?q=")
            self.assertEqual(r.json()["suggestions"], [])
            self.assertEqual(len(calls), 1)
        finally:
            os.environ.pop("GOOGLE_PLACES_API_KEY", None)


class TestListSheetFindStore(unittest.TestCase):
    def test_list_sheets_carry_the_google_picker_and_remove(self):
        l = src("screens/lists/ListSheets.tsx")
        for needle in ("/api/stores/places?q=", "/api/stores/places/pick",
                       "/api/stores/mine/remove", "data-ls-pick",
                       "data-ls-rm", 'id="ls-find"', "Near you"):
            self.assertIn(needle, l)
        self.assertEqual(l.count("<StorePicker "), 2)  # New list + Link stores


class TestPickerClient(unittest.TestCase):
    def test_picker_wiring(self):
        q = src("screens/Store.tsx")
        for needle in ("/api/stores/places?q=", "/api/stores/places/pick",
                       "data-gpick", "From Google",
                       "Pick your store from the list"):
            self.assertIn(needle, q)
        self.assertNotIn('id="sa-form"', q)

    def test_find_stores_wiring(self):
        # Find stores carries the same live Google dropdown as the
        # hunt picker and Add a store (owner, 2026-10-28: the Find
        # box searched the directory only, so a real store not yet
        # in the directory could never be found by name or address).
        q = src("screens/StoresFind.tsx")
        self.assertIn('<div id="sf-goog" className="gdrop"', q)
        self.assertIn("/api/stores/places?q=", q)
        self.assertIn("data-gpick", q)


class TestPickerRefreshOnBack(unittest.TestCase):
    """A store added via Find / Add a store must be selectable when
    the player comes Back to the picker: the picker is redrawn from
    My Stores, not left as it was drawn before they left it. The old
    node harness over quest.js questBack runs under vitest in
    web/src/screens/store.test.tsx."""

    def test_picker_reloads_on_every_open(self):
        q = src("screens/Store.tsx")
        self.assertIn("// from Find / Add, so a store added there can be picked).", q)
        self.assertIn("const m = await loadMine().catch(() => [] as MyStore[]);", q)
        self.assertIn("}, [nav.key]);", q)
        # App.tsx keys each screen by its stack entry, so Back remounts it.
        self.assertIn('className="view" key={nav.key}>', src("App.tsx"))

    def test_vitest_covers_back(self):
        t = src("screens/store.test.tsx")
        self.assertIn("Back to the picker reloads My Stores and draws the new store", t)
        self.assertIn("Back elsewhere leaves the picker alone", t)


class TestAddressOnlySearch(unittest.TestCase):
    """Typing only a store's address (no name) finds the store."""

    def setUp(self):
        make_client(self)

    def test_full_address_finds_store_without_its_name(self):
        from api import stores
        stores.upsert_google_store("pid-addr", "Trader Joe's", {
            "street": "4455 W Armitage Ave", "city": "Chicago",
            "state": "IL", "zip": "60639", "lat": 1, "lng": 2}, "t")
        for q in ("4455 W Armitage Ave, Chicago, IL 60639",
                  "4455 armitage chicago", "4455 W Armitage Ave"):
            names = [s["name"] for s in stores.search(q)]
            self.assertEqual(names, ["Trader Joe's"], q)
        self.assertEqual(stores.search("4455 Armitage Boston"), [])

    def test_client_picks_own_store_by_typed_address(self):
        # quest.js qStoreAtAddress, inline in Store.tsx pickStore: every
        # typed word must be in one of My Stores' addresses.
        q = src("screens/Store.tsx")
        pick = q.split("const pickStore = (nm: string, storeId: string | null) => {")[1].split("\n  };")[0]
        self.assertIn("const hay = norm(`${s.street} ${s.city} ${s.state} ${s.zip}`);", pick)
        self.assertIn("return toks.every(t => hay.includes(t));", pick)
        self.assertIn("if (hits.length === 1) {", pick)
