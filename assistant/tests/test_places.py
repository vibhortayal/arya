"""Google Places store picking (owner, 2026-10-28): a store is
picked from the API — name, address, place_id — never typed into
existence. The HTTP layer is faked; no key, no network."""
import os, tempfile, unittest
from pathlib import Path

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
os.environ.pop("GOOGLE_PLACES_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402

PWA = Path(__file__).resolve().parent.parent / "pwa"

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
    main.MetaClient = FakeClient
    main._login_fails.clear()
    case.c = TestClient(main.app)
    return case.c


class TestPlacesParsing(unittest.TestCase):
    def test_autocomplete_and_details_shapes(self):
        from api import places
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


class TestPickerClient(unittest.TestCase):
    def test_picker_wiring(self):
        q = (PWA / "quest.js").read_text()
        for needle in ("/api/stores/places?q=", "/api/stores/places/pick",
                       "data-gpick", "From Google",
                       "Pick the store from the list"):
            self.assertIn(needle, q)
        self.assertNotIn('$("#sa-form")', q)
