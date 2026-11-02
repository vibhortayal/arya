"""Full receipt line edit (owner, 2026-11-01): name, quantity and price on
a filed line; the printed total never changes, and totals_reconcile says
whether the lines still add up to it."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient


def receipt():
    return {"receipt_id": "R-1", "merchant": "Trader Jill's", "purchased_at": "2026-10-28",
            "source_type": "photo", "image_ref": None, "subtotal": 10.0, "tax": 0.0, "total": 10.0,
            "totals_reconcile": True,
            "lines": [
                {"raw": "MILK", "decoded_name": "Whole Milk", "qty": 1, "unit_price": 4.0,
                 "line_total": 4.0, "line_type": "item", "confidence": 0.9, "alternatives": []},
                {"raw": "EGGS", "decoded_name": "Eggs", "qty": 2, "unit_price": 3.5,
                 "line_total": 7.0, "line_type": "item", "confidence": 0.9, "alternatives": []},
                {"raw": "COUPON", "decoded_name": "Coupon", "qty": 1, "unit_price": -1.0,
                 "line_total": -1.0, "line_type": "discount", "confidence": 0.9, "alternatives": []}]}


class LineEdit(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        self.c = TestClient(main.app)
        self.assertEqual(self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"}).status_code, 200)
        with state.as_user("o@x.y"):
            state.add_receipts([receipt()])

    def edit(self, idx, **body):
        return self.c.post(f"/api/receipts/R-1/lines/{idx}", json=body)

    def detail(self):
        return self.c.get("/api/quest/receipts/R-1").json()

    def test_detail_shows_printed_text_and_edited_mark(self):
        lines = self.detail()["lines"]
        self.assertEqual(lines[0]["raw"], "MILK")
        self.assertNotIn("edited", lines[0])
        self.edit(0, name="Oat Milk")
        lines = self.detail()["lines"]
        self.assertEqual((lines[0]["name"], lines[0]["raw"], lines[0].get("edited")), ("Oat Milk", "MILK", True))
        self.assertNotIn("edited", lines[1])

    def test_price_edit_that_breaks_the_total_is_flagged(self):
        r = self.edit(0, line_total=5.0)
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(d["line"]["line_total"], 5.0)
        self.assertEqual(d["line"]["edited_from"]["line_total"], 4.0)
        self.assertFalse(d["totals_reconcile"])
        self.assertEqual((d["lines_sum"], d["total"], d["subtotal"]), (11.0, 10.0, 10.0))
        # The printed total stays as printed, and the receipt says so.
        det = self.detail()
        self.assertEqual(det.get("total"), 10.0)
        self.assertFalse(det.get("totals_reconcile"))
        # Undo: the same call with the old value; it adds up again.
        d = self.edit(0, line_total=4.0).json()
        self.assertTrue(d["totals_reconcile"])
        self.assertEqual(d["line"]["edited_from"]["line_total"], 4.0)

    def test_qty_sets_unit_price_and_name_renames(self):
        d = self.edit(1, qty=3, name="Large Eggs").json()
        self.assertEqual((d["line"]["qty"], d["line"]["unit_price"], d["line"]["decoded_name"]), (3, 2.33, "Large Eggs"))
        self.assertTrue(d["totals_reconcile"])  # price unchanged, still adds up

    def test_discount_keeps_its_sign(self):
        d = self.edit(2, line_total=2.0).json()
        self.assertEqual(d["line"]["line_total"], -2.0)

    def test_bad_input(self):
        self.assertEqual(self.edit(0).status_code, 400)
        self.assertEqual(self.edit(0, qty=0).status_code, 400)
        self.assertEqual(self.edit(0, line_total=-3).status_code, 400)
        self.assertEqual(self.edit(0, line_total="5").status_code, 400)
        self.assertEqual(self.edit(0, qty=True).status_code, 400)
        self.assertEqual(self.edit(9, qty=1).status_code, 404)
        self.assertEqual(self.c.post("/api/receipts/NOPE/lines/0", json={"qty": 1}).status_code, 404)

    def test_needs_sign_in(self):
        anon = TestClient(self.c.app)
        self.assertEqual(anon.post("/api/receipts/R-1/lines/0", json={"qty": 2}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
