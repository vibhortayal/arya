"""Kroger aisle hint (api/kroger.py): off by default, live only, never
stored, falls back to None on any failure. HTTP is faked; no key, no net."""
import os
import tempfile
import unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"

from api import kroger  # noqa: E402

STORE = {"id": "k1", "name": "Kroger - On the Rhine", "zip": "45202",
         "lat": 39.10682, "lng": -84.51253}
LOCS = {"data": [
    {"locationId": "far", "address": {"zipCode": "45209"},
     "geolocation": {"latitude": 39.14, "longitude": -84.43}},
    {"locationId": "01400513", "address": {"zipCode": "45202"},
     "geolocation": {"latitude": 39.10682, "longitude": -84.51253}}]}
MILK = {"data": [{"description": "Kroger 2% Milk", "aisleLocations": [
    {"description": "DAIRY", "number": "100", "side": "L",
     "bayNumber": "2", "shelfNumber": "4"}]}]}
PASTA = {"data": [{"description": "Pasta", "aisleLocations": [
    {"description": "PASTA", "number": "12", "side": "R", "bayNumber": "3"}]}]}


class Fake:
    def __init__(self, products, max_age=None):
        self.products, self.urls, self.max_age = products, [], max_age

    def __call__(self, url, headers, data=None):
        self.urls.append(url)
        hdr = {"Cache-Control": "max-age=%d" % self.max_age} if self.max_age else {}
        if "oauth2/token" in url:
            return {"access_token": "t", "expires_in": 1800}, hdr
        if "/locations" in url:
            return LOCS, hdr
        return self.products, hdr


class TestKroger(unittest.TestCase):
    def setUp(self):
        for k in ("ARYA_KROGER_AISLES", "KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET"):
            os.environ.pop(k, None)
        kroger._cache.clear()
        kroger._token.update(value=None, expires=0.0)
        kroger._calls.update(day=None, n=0)
        self._http = kroger._http

    def tearDown(self):
        kroger._http = self._http

    def on(self):
        os.environ.update(ARYA_KROGER_AISLES="1", KROGER_CLIENT_ID="id",
                          KROGER_CLIENT_SECRET="secret")

    def test_off_by_default_and_needs_credentials(self):
        self.assertFalse(kroger.enabled())
        os.environ["ARYA_KROGER_AISLES"] = "1"
        self.assertFalse(kroger.enabled())
        self.on()
        self.assertTrue(kroger.enabled())

    def test_family_match(self):
        self.assertTrue(kroger.is_kroger_family("Ralphs"))
        self.assertTrue(kroger.is_kroger_family("Fred Meyer #650"))
        self.assertFalse(kroger.is_kroger_family("Trader Joe's"))

    def test_hint_for_fresh_department_has_no_aisle_number(self):
        self.on()
        kroger._http = Fake(MILK)
        hint = kroger.aisle_hint(STORE, "milk")
        self.assertEqual(hint["department"], "DAIRY")   # shown as returned
        self.assertNotIn("aisle", hint)
        self.assertEqual((hint["side"], hint["bay"], hint["shelf"]), ("L", "2", "4"))

    def test_hint_with_aisle_number_uses_matching_location(self):
        self.on()
        fake = kroger._http = Fake(PASTA)
        hint = kroger.aisle_hint(STORE, "pasta")
        self.assertEqual(hint["aisle"], "12")
        self.assertTrue(any("filter.locationId=01400513" in u for u in fake.urls))

    def test_trip_hints_one_location_lookup_and_skips_misses(self):
        self.on()
        fake = kroger._http = Fake(PASTA)
        out = kroger.trip_hints(STORE, ["pasta", "Pasta", "rice", ""])
        self.assertEqual(sorted(out), ["pasta", "rice"])
        self.assertEqual(sum("/locations" in u for u in fake.urls), 1)

    def test_trip_hints_off_returns_empty(self):
        self.assertEqual(kroger.trip_hints(STORE, ["milk"]), {})

    def test_non_kroger_store_makes_no_calls(self):
        self.on()
        fake = kroger._http = Fake(MILK)
        self.assertIsNone(kroger.aisle_hint({"name": "Trader Joe's", "zip": "45202"}, "milk"))
        self.assertEqual(fake.urls, [])

    def test_wrong_store_location_is_not_used(self):
        self.on()
        kroger._http = Fake(MILK)
        other = dict(STORE, lat=None, lng=None, zip="99999")
        self.assertIsNone(kroger.aisle_hint(other, "milk"))

    def test_nothing_cached_without_cache_header(self):
        self.on()
        fake = kroger._http = Fake(MILK)
        kroger.aisle_hint(STORE, "milk")
        n = len(fake.urls)
        kroger.aisle_hint(STORE, "milk")
        self.assertEqual(len(fake.urls) - n, 2)   # locations + products again
        self.assertEqual(kroger._cache, {})

    def test_cache_header_is_honoured(self):
        self.on()
        fake = kroger._http = Fake(MILK, max_age=60)
        kroger.aisle_hint(STORE, "milk")
        n = len(fake.urls)
        kroger.aisle_hint(STORE, "milk")
        self.assertEqual(len(fake.urls), n)

    def test_any_failure_falls_back_to_none(self):
        self.on()
        def boom(*a, **k):
            raise OSError("down")
        kroger._http = boom
        self.assertIsNone(kroger.aisle_hint(STORE, "milk"))

    def test_daily_cap(self):
        self.on()
        os.environ["ARYA_KROGER_DAILY_CALLS"] = "1"
        try:
            kroger._http = Fake(MILK)
            self.assertIsNone(kroger.aisle_hint(STORE, "milk"))
        finally:
            os.environ.pop("ARYA_KROGER_DAILY_CALLS")


class TestKrogerRoute(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from api import main, stores
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        for k in ("ARYA_KROGER_AISLES", "KROGER_CLIENT_ID", "KROGER_CLIENT_SECRET"):
            os.environ.pop(k, None)
        self.stores = stores
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "kr", "password": "pw-kr-12345"})
        self.assertLess(r.status_code, 300, r.text)

    def test_flag_off_answers_disabled(self):
        sid = self.stores.directory()[0]["id"]
        r = self.c.get("/api/stores/kroger-aisle", params={"store_id": sid, "item": "milk"})
        self.assertEqual(r.json(), {"enabled": False, "hint": None})

    def test_trip_route_flag_off_and_validation(self):
        sid = self.stores.directory()[0]["id"]
        r = self.c.post("/api/stores/kroger-trip", json={"store_id": sid, "items": ["milk"]})
        self.assertEqual(r.json(), {"enabled": False, "hints": {}})
        r = self.c.post("/api/stores/kroger-trip", json={"store_id": "nope", "items": []})
        self.assertEqual(r.status_code, 404)

    def test_unknown_store_404(self):
        r = self.c.get("/api/stores/kroger-aisle", params={"store_id": "nope", "item": "milk"})
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
