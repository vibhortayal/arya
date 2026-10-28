import json, os, unittest
from api.decode.service import decode_text, normalize_costco_json

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "golden")


def load(name):
    return json.load(open(os.path.join(GOLDEN, name)))


class StubClient:
    def chat(self, messages, **kw):
        assert kw.get("personal") is True and kw.get("mode") == "standard"
        payload = {"merchant": "Costco", "purchased_at": "2026-10-01",
                   "lines": [
                       {"raw": "ORG SPINACH", "sku": "96716", "decoded_name": "Organic Spinach",
                        "qty": 1, "unit_price": 5.39, "line_total": 5.39, "line_type": "item",
                        "discount_parent_sku": None, "confidence": 0.95, "alternatives": []},
                       {"raw": "SAVINGS", "sku": None, "decoded_name": "Instant Savings",
                        "qty": 1, "unit_price": -1.40, "line_total": -1.40, "line_type": "discount",
                        "discount_parent_sku": None, "confidence": 0.9, "alternatives": []},
                       {"raw": "MYSTERY", "sku": None, "decoded_name": "Unknown Item",
                        "qty": 1, "unit_price": 3.00, "line_total": 3.00, "line_type": "item",
                        "discount_parent_sku": None, "confidence": 0.5, "alternatives": ["A", "B"]}],
                   "subtotal": 6.99, "tax": 0.0, "total": 6.99}
        return json.dumps(payload), {}, 0.01


class TestJsonImport(unittest.TestCase):
    def test_sales_receipt_normalizes(self):
        r = normalize_costco_json(load("synthetic-costco-receipt.json"))
        self.assertTrue(r["totals_reconcile"])
        types = [l["line_type"] for l in r["lines"]]
        self.assertEqual(types, ["item", "item", "discount"])
        disc = r["lines"][2]
        self.assertEqual(disc["discount_parent_sku"], "1063232")  # previous item
        self.assertTrue(all(l["allocation"] == "HOUSEHOLD" for l in r["lines"]))

    def test_refund_lines_are_returns(self):
        r = normalize_costco_json(load("synthetic-costco-refund.json"))
        self.assertTrue(r["totals_reconcile"])
        self.assertEqual(r["lines"][0]["line_type"], "return")
        self.assertEqual(r["lines"][0]["qty"], 1)


class TestDecodeText(unittest.TestCase):
    def test_post_rules(self):
        r = decode_text("any text", StubClient())
        self.assertTrue(r["totals_reconcile"])
        self.assertEqual(r["lines"][0]["status"], "auto")
        self.assertEqual(r["lines"][2]["status"], "unverified")   # low confidence
        self.assertEqual(r["lines"][1]["discount_parent_sku"], "96716")
        self.assertEqual(r["lines"][1]["status"], "auto")   # discounts are structural; never queued


class TestApi(unittest.TestCase):
    def test_import_route(self):
        import tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        from fastapi.testclient import TestClient
        from api.main import app
        c = TestClient(app)
        self.assertEqual(c.get("/api/home").status_code, 401)  # auth gate
        c.post("/auth/setup", json={"username": "test", "password": "pw-test"})
        resp = c.post("/import/costco-json", json=load("synthetic-costco-receipt.json"))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["totals_reconcile"])
        self.assertEqual(c.post("/import/costco-json", json={"nope": 1}).status_code, 422)
        self.assertEqual(c.get("/health").json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()


class TestSlashLines(unittest.TestCase):
    def test_coupon_line_attaches_to_item_above(self):
        obj = {"transactionBarcode": "T1", "transactionDate": "2026-10-22",
               "transactionType": "Sales", "warehouseName": "X",
               "subTotal": 12.99, "taxes": 0, "total": 12.99,
               "itemArray": [
                   {"itemNumber": "1901576", "itemDescription01": "KG BLANKET", "itemDescription02": None, "unit": 1, "amount": 18.99},
                   {"itemNumber": "397161", "itemDescription01": "/ 1901576", "itemDescription02": None, "unit": -1, "amount": -6.00}]}
        r = normalize_costco_json(obj)
        self.assertTrue(r["totals_reconcile"])
        self.assertEqual(r["lines"][1]["line_type"], "discount")
        self.assertEqual(r["lines"][1]["discount_parent_sku"], "1901576")
        self.assertEqual(r["lines"][1]["status"], "auto")


class TestPdfIntake(unittest.TestCase):
    FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "receipt.pdf")

    def test_extract_text(self):
        from api.decode.service import extract_pdf_text
        text = extract_pdf_text(open(self.FIXTURE, "rb").read())
        self.assertIn("SPINACH", text)
        self.assertIn("25.36", text)

    def test_pdf_endpoint(self):
        import tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        os.environ["MODEL_API_KEY"] = "test-key"
        from fastapi.testclient import TestClient
        import api.main as main

        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None):
                payload = {"merchant": "Costco Example City", "purchased_at": "2026-10-20",
                           "lines": [{"raw": "spinach", "sku": "1", "line_type": "item",
                                      "qty": 1, "line_total": 5.39, "confidence": 0.95},
                                     {"raw": "egg white", "sku": "2", "line_type": "item",
                                      "qty": 1, "line_total": 19.97, "confidence": 0.95}],
                           "subtotal": 25.36, "tax": 0.0, "total": 25.36}
                return json.dumps(payload), {}, 0.001

        main.MetaClient = FakeClient
        c = TestClient(main.app)
        c.post("/auth/setup", json={"username": "t", "password": "pw"})
        r = c.post("/decode/pdf", content=open(self.FIXTURE, "rb").read(),
                   headers={"Content-Type": "application/pdf"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["receipt"]["totals_reconcile"])
        self.assertEqual(c.post("/decode/pdf", content=b"").status_code, 400)
        self.assertEqual(c.post("/decode/pdf", content=b"not a pdf").status_code, 422)


class TestPhotoIntake(unittest.TestCase):
    def _fake_client(self, payload):
        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None, **kw):
                # Photo decode reads with Wonder first (MODEL-POLICY
                # hackathon amendment, through 2026-11-04).
                assert personal is True and mode == "wonder"
                return json.dumps(payload), {}, 0.12
        return FakeClient

    def test_photo_normalization(self):
        from api.decode.service import decode_photo
        payload = {"store": "Safeway", "date": "2026-07-29", "subtotal": 8.98, "tax": 0.0, "total": 8.98,
                   "lines": [{"item_no": "123", "product": "MILK WHL GAL", "brand": None, "detail": None,
                              "list_price": 4.49, "price": 4.49, "discount": 0, "qty": 1,
                              "is_return": False, "confidence": 0.95, "needs_user_check": False, "alternatives": []},
                             {"item_no": None, "product": "BREAD", "brand": "GG", "detail": None,
                              "list_price": 5.49, "price": 4.49, "discount": 1.0, "qty": 1,
                              "is_return": False, "confidence": 0.7, "needs_user_check": True, "alternatives": ["BRD"]}]}
        dec = decode_photo(b"fake-jpeg-bytes", self._fake_client(payload)())
        self.assertEqual(dec["decoded_by"], "muse-wonder-1.0")
        self.assertTrue(dec["totals_reconcile"])
        self.assertEqual(dec["lines"][0]["status"], "auto")
        self.assertEqual(dec["lines"][1]["status"], "unverified")   # needs_user_check forces review
        self.assertEqual(dec["lines"][1]["discount_amount"], 1.0)
        self.assertEqual(dec["lines"][1]["decoded_name"], "GG BREAD")

    def test_photo_endpoint(self):
        import tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        os.environ["MODEL_API_KEY"] = "test-key"
        from fastapi.testclient import TestClient
        import api.main as main
        payload = {"store": "Safeway", "date": "2026-07-29", "subtotal": 4.49, "tax": 0.0, "total": 4.49,
                   "lines": [{"item_no": "1", "product": "MILK", "brand": None, "detail": None,
                              "list_price": 4.49, "price": 4.49, "discount": 0, "qty": 1,
                              "is_return": False, "confidence": 0.95, "needs_user_check": False, "alternatives": []}]}
        main.MetaClient = self._fake_client(payload)
        c = TestClient(main.app)
        c.post("/auth/setup", json={"username": "t", "password": "pw"})
        r = c.post("/decode/photo", content=b"\xff\xd8\xff fake", headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["receipt"]["totals_reconcile"])
        self.assertEqual(r.json()["receipt"]["decoded_by"], "muse-wonder-1.0")
        self.assertEqual(c.post("/decode/photo", content=b"x", headers={"Content-Type": "text/plain"}).status_code, 415)


PHOTO_PAYLOAD = {"store": "Safeway", "date": "2026-07-29", "subtotal": 4.49,
                 "tax": 0.0, "total": 4.49,
                 "lines": [{"item_no": "1", "product": "MILK WHL GAL", "brand": None,
                            "detail": None, "list_price": 4.49, "price": 4.49,
                            "discount": 0, "qty": 1, "is_return": False,
                            "confidence": 0.95, "needs_user_check": False,
                            "alternatives": []}]}


class FlipClient:
    """chat() stub for the Wonder flip: Wonder's behavior is injected,
    Spark always answers. Every call is recorded."""

    def __init__(self, wonder_exc=None, wonder_out=None):
        self.calls = []
        self.wonder_exc = wonder_exc
        self.wonder_out = wonder_out

    def chat(self, messages, mode=None, personal=None, **kw):
        self.calls.append({"mode": mode, "personal": personal, **kw})
        if mode == "wonder":
            if self.wonder_exc is not None:
                raise self.wonder_exc
            return self.wonder_out or json.dumps(PHOTO_PAYLOAD), {}, 0.12
        assert mode == "standard" and personal is True
        return json.dumps(PHOTO_PAYLOAD), {}, 0.013


class TestPhotoDecodeWonderFlip(unittest.TestCase):
    def test_wonder_is_the_photo_reader(self):
        from api.decode.service import decode_photo, PHOTO_WONDER_TIMEOUT_S
        client = FlipClient()
        dec = decode_photo(b"fake-jpeg-bytes", client)
        self.assertEqual(dec["decoded_by"], "muse-wonder-1.0")
        self.assertTrue(dec["totals_reconcile"])
        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertEqual(call["mode"], "wonder")
        self.assertIs(call["personal"], True)
        # The eval's Wonder configuration: no reasoning_effort key, and
        # the attempt is bounded (eval p95 was 60.5 s; bound is 90 s).
        self.assertIsNone(call["reasoning_effort"])
        self.assertEqual(call["timeout"], PHOTO_WONDER_TIMEOUT_S)
        self.assertEqual(PHOTO_WONDER_TIMEOUT_S, 90)

    def test_spark_only_setting_never_calls_wonder(self):
        import os
        from unittest import mock
        from api.decode.service import decode_photo
        client = FlipClient()
        with mock.patch.dict(os.environ, {"ARYA_PHOTO_READER": "spark"}):
            dec = decode_photo(b"fake-jpeg-bytes", client)
        self.assertEqual(dec["decoded_by"], "muse-spark-1.3")
        self.assertTrue(dec["totals_reconcile"])
        self.assertEqual([c["mode"] for c in client.calls], ["standard"])

    def test_wonder_timeout_falls_back_to_spark(self):
        from api.decode.service import decode_photo
        client = FlipClient(wonder_exc=TimeoutError("read timed out"))
        dec = decode_photo(b"fake-jpeg-bytes", client)
        # The SAME photo completes via Spark, marked as Spark-read.
        self.assertEqual(dec["decoded_by"], "muse-spark-1.3")
        self.assertTrue(dec["totals_reconcile"])
        self.assertEqual(dec["lines"][0]["decoded_name"], "MILK WHL GAL")
        self.assertEqual([c["mode"] for c in client.calls], ["wonder", "standard"])

    def test_wonder_http_error_falls_back_to_spark(self):
        from api.decode.service import decode_photo
        client = FlipClient(wonder_exc=RuntimeError("Meta API HTTP 500: boom"))
        dec = decode_photo(b"fake-jpeg-bytes", client)
        self.assertEqual(dec["decoded_by"], "muse-spark-1.3")
        self.assertEqual([c["mode"] for c in client.calls], ["wonder", "standard"])

    def test_wonder_garbage_output_falls_back_to_spark(self):
        from api.decode.service import decode_photo
        client = FlipClient(wonder_out="I cannot read this receipt.")
        dec = decode_photo(b"fake-jpeg-bytes", client)
        self.assertEqual(dec["decoded_by"], "muse-spark-1.3")

    def test_non_photo_paths_have_no_decoded_by(self):
        # Scope pin: the flip is photo-only. Text decode stays Spark and
        # carries no decoded_by (its StubClient asserts mode=standard).
        r = decode_text("any text", StubClient())
        self.assertNotIn("decoded_by", r)
