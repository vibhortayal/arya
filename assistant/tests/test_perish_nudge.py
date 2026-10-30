"""After a receipt, Today asks for use-by dates on what goes off (#207,
owner 2026-10-30). Guessing is plain rules at $0; the card is asked
once per receipt and stops for good after two "Not now"s."""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from api import expiry  # noqa: E402

TODAY = date(2026, 10, 30)


def rec(rid, day, names, merchant="Safeway"):
    return {"receipt_id": rid, "source_type": "grocery", "merchant": merchant,
            "purchased_at": day.isoformat(),
            "lines": [{"decoded_name": n, "item_id": "i-" + n.split()[0].lower(),
                       "line_type": "item", "qty": 1, "line_total": 1.0} for n in names]}


class TestPerishable(unittest.TestCase):
    def test_rules(self):
        for n in ("Whole Milk 1 gal", "Baby Spinach 16 oz", "Greek Yogurt 32 oz", "Bananas",
                  "Chicken Breast", "Pasture Eggs 12 ct", "Sourdough Loaf", "Raspberries"):
            self.assertTrue(expiry.perishable(n), n)
        for n in ("Jasmine Rice 10 lb", "Paper Towels 6 ct", "Coffee Beans 12 oz", "Frozen Peas",
                  "Chicken Broth", "Peanut Butter", "Canned Tomatoes", "AA Batteries 8 ct"):
            self.assertFalse(expiry.perishable(n), n)


class TestReceiptNudge(unittest.TestCase):
    def nudge(self, receipts, flags=None, seen=None):
        return expiry.receipt_nudge(receipts, flags or {}, seen, TODAY)

    def test_newest_receipt_with_two_perishables(self):
        rs = [rec("old", TODAY - timedelta(days=5), ["Whole Milk", "Baby Spinach 16 oz"]),
              rec("new", TODAY - timedelta(days=1), ["Bananas", "Paper Towels"]),
              rec("mid", TODAY - timedelta(days=3), ["Greek Yogurt", "Chicken Breast", "Rice"])]
        n = self.nudge(rs)
        # "new" has one perishable only, so the next newest is asked about.
        self.assertEqual(n["receipt_id"], "mid")
        self.assertEqual([i["name"] for i in n["items"]], ["Greek Yogurt", "Chicken Breast"])
        self.assertEqual((n["store"], n["date"]), ("Safeway", (TODAY - timedelta(days=3)).isoformat()))

    def test_old_receipts_and_answered_ones_are_not_asked(self):
        old = [rec("r", TODAY - timedelta(days=expiry.NUDGE_DAYS + 1), ["Whole Milk", "Bananas"])]
        self.assertIsNone(self.nudge(old))
        r = [rec("r", TODAY - timedelta(days=2), ["Whole Milk", "Bananas"])]
        self.assertIsNone(self.nudge(r, seen=(TODAY - timedelta(days=2)).isoformat()))
        self.assertIsNotNone(self.nudge(r, seen=(TODAY - timedelta(days=3)).isoformat()))

    def test_dated_since_the_trip_is_left_out_and_cap_is_eight(self):
        day = TODAY - timedelta(days=2)
        names = ["Whole Milk", "Bananas", "Kale", "Apples", "Pears", "Plums", "Yogurt", "Butter", "Cheese", "Bacon"]
        flags = {"i-whole": {"use_by": "2026-11-05", "use_by_set": TODAY.isoformat()}}
        n = self.nudge([rec("r", day, names)], flags)
        self.assertEqual(len(n["items"]), expiry.NUDGE_MAX_ITEMS)
        self.assertNotIn("i-whole", [i["item_id"] for i in n["items"]])
        # A date set before this trip was for the last package: ask again.
        flags = {"i-whole": {"use_by": "2026-10-20", "use_by_set": "2026-10-10"}}
        self.assertIn("i-whole", [i["item_id"] for i in self.nudge([rec("r", day, names)], flags)["items"]])

    def test_returns_and_non_grocery_are_skipped(self):
        r = rec("r", TODAY - timedelta(days=1), ["Whole Milk", "Bananas"])
        r["lines"][0]["line_type"] = "return"
        self.assertIsNone(self.nudge([r]))
        r2 = rec("r2", TODAY - timedelta(days=1), ["Whole Milk", "Bananas"])
        r2["source_type"] = "restaurant"
        self.assertIsNone(self.nudge([r2]))


class TestRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps, state
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "p@x.y", "password": "long-password"})
        today = date.fromisoformat(state.today_ref())
        self.days = [(today - timedelta(days=k)).isoformat() for k in (6, 3, 1)]
        with state.as_user("p@x.y"):
            state._save("receipts.json", [
                rec("a", today - timedelta(days=6), ["Whole Milk", "Baby Spinach"]),
                rec("b", today - timedelta(days=3), ["Greek Yogurt", "Bananas"])])

    def home(self):
        return self.c.get("/api/home").json()["perishables"]

    def test_card_then_not_now_twice_stops_for_good(self):
        self.assertEqual(self.home()["receipt_id"], "b")
        r = self.c.post("/api/expiry/nudge", json={"action": "not_now", "date": self.days[1]})
        self.assertEqual(r.status_code, 200)
        # Not now on the newest one also covers anything older.
        self.assertIsNone(self.home())
        from api import state
        with state.as_user("p@x.y"):
            rs = state._load("receipts.json", [])
            rs.append(rec("c", date.fromisoformat(self.days[2]), ["Kale", "Butter"]))
            state._save("receipts.json", rs)
        self.assertEqual(self.home()["receipt_id"], "c")
        self.c.post("/api/expiry/nudge", json={"action": "not_now", "date": self.days[2]})
        with state.as_user("p@x.y"):
            rs = state._load("receipts.json", [])
            rs.append(rec("d", date.fromisoformat(state.today_ref()), ["Plums", "Pears"]))
            state._save("receipts.json", rs)
        self.assertIsNone(self.home())

    def test_done_only_moves_past_this_receipt(self):
        self.c.post("/api/expiry/nudge", json={"action": "done", "date": self.days[1]})
        self.assertIsNone(self.home())
        from api import state
        with state.as_user("p@x.y"):
            rs = state._load("receipts.json", [])
            rs.append(rec("c", date.fromisoformat(self.days[2]), ["Kale", "Butter"]))
            state._save("receipts.json", rs)
        self.assertEqual(self.home()["receipt_id"], "c")

    def test_bad_bodies(self):
        self.assertEqual(self.c.post("/api/expiry/nudge", json={"action": "later", "date": self.days[1]}).status_code, 400)
        self.assertEqual(self.c.post("/api/expiry/nudge", json={"action": "done"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
