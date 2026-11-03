"""The demo's receipt second read (owner, 2026-11-03, demo only): Spark's
read comes back first; Wonder's read lands later through /decode/check,
in memory and in the visitor's sandbox only."""
import json, os, tempfile, time, unittest
from unittest import mock

os.environ.setdefault("ARYA_INSECURE_COOKIE", "1")
from api.decode import second_read, service
from tests.test_photo_checks import FakeClient, dec


def wait(jid, tries=200):
    for _ in range(tries):
        out = second_read.check(jid)
        if out and out["state"] != "pending":
            return out
        time.sleep(0.01)
    return second_read.check(jid)


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_PHOTO_READER"] = "auto"
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        self.addCleanup(os.environ.pop, "ARYA_PHOTO_READER", None)


class TestSparkFirst(Base):
    def test_a_clean_read_has_no_second_read(self):
        c = FakeClient(dec([3.99, 7.49, 4.29]))
        rec, reasons, second = service.decode_photo_spark_first(b"a", c)
        self.assertEqual((reasons, second), ([], None))
        self.assertEqual(rec["decoded_by"], service.spark_model())
        self.assertEqual(c.calls, ["standard"])

    def test_a_flagged_read_returns_spark_now_and_wonder_later(self):
        c = FakeClient(dec([3.99, 1.49, 4.29], subtotal=15.77), dec([3.99, 7.49, 4.29]))
        rec, reasons, second = service.decode_photo_spark_first(b"b", c)
        self.assertEqual(c.calls, ["standard"])                 # Wonder not called yet
        self.assertEqual(rec["decoded_by"], service.spark_model())
        self.assertIn("lines_do_not_add_up", reasons)
        done = second()
        self.assertEqual(c.calls, ["standard", "wonder"])
        self.assertEqual(done["decoded_by"], service.MODELS["wonder"])

    def test_spark_failing_outright_keeps_the_one_step_read(self):
        c = FakeClient(None, dec([3.99, 7.49]), spark_err=True)
        rec, reasons, second = service.decode_photo_spark_first(b"c", c)
        self.assertIsNone(second)
        self.assertEqual(rec["decoded_by"], service.MODELS["wonder"])

    def test_other_readers_are_unchanged(self):
        os.environ["ARYA_PHOTO_READER"] = "spark"
        c = FakeClient(dec([3.99, 1.49], subtotal=9.0))
        rec, reasons, second = service.decode_photo_spark_first(b"d", c)
        self.assertIsNone(second)


class TestOutcome(Base):
    def setUp(self):
        super().setUp()
        from api import state
        self.state = state
        self.tok = state._overlay.set({})
        self.addCleanup(state._overlay.reset, self.tok)

    def start(self, wonder, wonder_err=False):
        c = FakeClient(dec([3.99, 1.49, 4.29], subtotal=15.77), wonder, wonder_err=wonder_err)
        rec, reasons, second = service.decode_photo_spark_first(b"e" + os.urandom(4), c)
        rec["live"] = True
        self.state.add_receipts([rec])
        return rec, second_read.start(rec, reasons, second)

    def test_changed_marks_lines_and_swaps_the_sandbox_copy(self):
        rec, jid = self.start(dec([3.99, 7.49, 4.29], subtotal=15.77))
        out = wait(jid)
        self.assertEqual(out["state"], "changed")
        self.assertEqual(out["fixed"], 1)
        changed = [l for l in out["receipt"]["lines"] if "was" in l]
        self.assertEqual(changed[0]["was"], {"price": 1.49})
        self.assertEqual(changed[0]["line_total"], 7.49)
        kept = self.state._load("receipts.json", [])
        self.assertEqual([r["decoded_by"] for r in kept], [service.MODELS["wonder"]])
        self.assertTrue(kept[0]["live"])
        self.assertNotIn("was", kept[0]["lines"][1])                # the marks are display only

    def test_same_read(self):
        rec, jid = self.start(dec([3.99, 1.49, 4.29], subtotal=15.77))
        out = wait(jid)
        self.assertEqual(out["state"], "same")
        self.assertNotIn("fixed", out)

    def test_failed_keeps_spark_with_lines_to_check(self):
        rec, jid = self.start(None, wonder_err=True)
        out = wait(jid)
        self.assertEqual(out["state"], "failed")
        self.assertEqual(out["receipt"]["decoded_by"], service.spark_model())
        self.assertTrue(all(l["status"] == "unverified" for l in out["receipt"]["lines"]))
        self.assertIn("wonder_failed", out["receipt"]["second_read"])

    def test_pending_while_wonder_reads(self):
        rec = {"receipt_id": "x", "decoded_by": "spark", "lines": [], "total": 1}
        gate = __import__("threading").Event()
        jid = second_read.start(rec, ["total_mismatch"], lambda: gate.wait(2) and None)
        self.assertEqual(second_read.check(jid), {"state": "pending", "reasons": ["total_mismatch"]})
        gate.set()

    def test_another_visitor_cannot_read_it(self):
        rec, jid = self.start(dec([3.99, 7.49, 4.29], subtotal=15.77))
        tok = self.state._overlay.set({})
        try:
            self.assertIsNone(second_read.check(jid))
        finally:
            self.state._overlay.reset(tok)
        self.assertIsNone(second_read.check("nope"))


class TestRoute(Base):
    def setUp(self):
        super().setUp()
        from fastapi.testclient import TestClient
        from api import demo_guard
        import api.main as main
        demo_guard._demo_auth_hits.clear()
        demo_guard._demo_door_hits.clear()
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        self.c = TestClient(main.app)
        r = self.c.post("/auth/demo")
        self.assertEqual(r.status_code, 200, r.text)
        self.data = os.environ["ARYA_DATA_DIR"]

    def disk(self):
        out = []
        for root, _, files in os.walk(self.data):
            out += [os.path.join(root, f) for f in files if f == "receipts.json"]
        return out

    def post(self, client):
        with mock.patch("api.routes.intake.new_client", return_value=client), \
                mock.patch("api.own_key.need_model", return_value=None):
            return self.c.post("/decode/photo", content=b"\xff\xd8photo" + os.urandom(4),
                               headers={"Content-Type": "image/jpeg"})

    def test_demo_gets_spark_now_and_a_check_to_poll(self):
        before = self.disk()
        r = self.post(FakeClient(dec([3.99, 1.49, 4.29], subtotal=15.77), dec([3.99, 7.49, 4.29], subtotal=15.77)))
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["demo"])
        self.assertEqual(body["receipt"]["decoded_by"], service.spark_model())
        self.assertIn("lines_do_not_add_up", body["check"]["reasons"])
        jid = body["check"]["id"]
        for _ in range(200):
            out = self.c.get(f"/decode/check/{jid}").json()
            if out["state"] != "pending":
                break
            time.sleep(0.01)
        self.assertEqual(out["state"], "changed")
        self.assertEqual(out["receipt"]["decoded_by"], service.MODELS["wonder"])
        self.assertEqual(self.disk(), before)                       # memory only

    def test_a_clean_demo_read_has_no_check(self):
        r = self.post(FakeClient(dec([3.99, 7.49, 4.29])))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("check", r.json())

    def test_check_is_demo_only(self):
        self.c.cookies.clear()
        self.assertEqual(self.c.get("/decode/check/abc").status_code, 401)


if __name__ == "__main__":
    unittest.main()
