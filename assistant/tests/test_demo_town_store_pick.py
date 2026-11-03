"""Demo Town store pick (owner bug, 2026-11-03): in the demo, Map my
store, Find a store near me (or a typed search), then a tapped store
showed "null is not an object (evaluating 'e.name')". The pick saved a
Google store that Demo Town's directory never shows, so the joined row
came back null with a 200 and the app read .name on it. In Demo Town the
pickers name only the town's stores: Google is never asked, a pick is a
clear 400, and a pick never answers 200 with nothing."""
from unittest import mock

from tests.test_demo_town import TownCase


class TestDemoTownPick(TownCase):
    def test_places_search_is_quiet_in_demo_town(self):
        from api import places
        with mock.patch.object(places, "provisioned", return_value=True), \
                mock.patch.object(places, "autocomplete", side_effect=AssertionError("no Google call")), \
                mock.patch.object(places, "_text_search_stores", side_effect=AssertionError("no Google call")):
            near = self.c.get("/api/stores/places?q=&lat=34.0&lng=-117.7").json()
            typed = self.c.get("/api/stores/places?q=trader&session=s1").json()
        for d in (near, typed):
            self.assertEqual(d["suggestions"], [])
            self.assertTrue(d["demo_town"])

    def test_a_pick_is_a_clear_error_never_a_null_row(self):
        from api import places
        det = {"street": "1 Main St", "city": "Chino Hills", "state": "CA", "zip": "91709", "lat": 34.0, "lng": -117.7}
        with mock.patch.object(places, "provisioned", return_value=True), \
                mock.patch.object(places, "details", return_value=det):
            r = self.c.post("/api/stores/places/pick", json={"place_id": "gp-1", "name": "Trader Joe's"})
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn("Demo Town", r.json()["detail"])
        names = {s["name"] for s in self.c.get("/api/stores/mine").json()["stores"]}
        self.assertNotIn("Trader Joe's", names)       # no real store joined the demo


class TestPickNeverAnswersNull(TownCase):
    flag = "0"

    def test_an_unknown_joined_row_is_409(self):
        from api import places, stores
        det = {"street": "1 Main St", "city": "Chino Hills", "state": "CA", "zip": "91709", "lat": 34.0, "lng": -117.7}
        with mock.patch.object(places, "provisioned", return_value=True), \
                mock.patch.object(places, "details", return_value=det), \
                mock.patch.object(stores, "add_to_mine", return_value=None):
            r = self.c.post("/api/stores/places/pick", json={"place_id": "gp-2", "name": "Corner Market"})
        self.assertEqual(r.status_code, 409, r.text)


if __name__ == "__main__":
    import unittest
    unittest.main()
