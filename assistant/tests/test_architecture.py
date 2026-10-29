"""Architecture: structured intake (Muse perceives, Arya verifies) and
the Curator (identity reasoning with proposals, never silent edits)."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

CURATOR_JSON = json.dumps({"merges": [
    {"members": ["sku-eggs-a", "sku-eggs-b"], "name": "Kirkland Signature Eggs",
     "reason": "same eggs, spelling variant"}],
    "splits": []})


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        assert personal and mode == "standard"
        blob = " ".join(m.get("content", "") for m in messages)
        if "household grocery model" in blob:
            return CURATOR_JSON, {}, 0.001
        return json.dumps({"verdicts": []}), {}, 0.0


def seed_dictionary():
    from api import state
    state._save("dictionary.json", {"entries": [
        {"item_id": "sku-eggs-a", "sku": "111", "canonical_name": "Kirkland Signature 5Dz Eggs"},
        {"item_id": "sku-eggs-b", "sku": "222", "canonical_name": "Kirkland Signature 5 Dz Eggs"},
        {"item_id": "sku-eggs-org", "sku": "333", "canonical_name": "Organic Fr Eggs"}]})
    state._save("receipts.json", [{
        "receipt_id": "r1", "merchant": "Costco", "purchased_at": "2026-10-01",
        "source_type": "grocery", "lines": [
            {"item_id": "sku-eggs-a", "sku": "111", "qty": 1, "line_type": "item", "line_total": 9.0,
             "status": "auto", "decoded_name": "Kirkland Signature 5Dz Eggs"},
            {"item_id": "sku-eggs-b", "sku": "222", "qty": 1, "line_type": "item", "line_total": 9.0,
             "status": "auto", "decoded_name": "Kirkland Signature 5 Dz Eggs"},
            {"item_id": "sku-eggs-org", "sku": "333", "qty": 1, "line_type": "item", "line_total": 12.0,
             "status": "auto", "decoded_name": "Organic Fr Eggs"}],
        "subtotal": 30.0, "tax": 0, "total": 30.0, "totals_reconcile": True,
        "image_ref": None}])


class TestArchitecture(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.main = main
        self.c = TestClient(main.app)
        seed_dictionary()  # seeded at the root; the first account adopts it
        r = self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_structured_intake_verifies(self):
        good = {"merchant": "Trader Joe's", "purchased_at": "2026-10-25",
                "lines": [{"decoded_name": "Oat Milk", "qty": 1, "line_total": 4.5,
                           "confidence": 0.95}],
                "subtotal": 4.5, "total": 4.5}
        r = self.c.post("/api/intake/structured", json=good)
        assert r.status_code == 200, r.text
        assert r.json()["totals_reconcile"] is True and r.json()["unverified"] == 0
        # a lying subtotal is caught by arithmetic, not trusted
        bad = dict(good, subtotal=99.0, receipt_id="ext-bad1")
        r = self.c.post("/api/intake/structured", json=bad)
        assert r.json()["totals_reconcile"] is False
        # a line without a name or total is refused
        r = self.c.post("/api/intake/structured", json={
            "merchant": "X", "purchased_at": "2026-10-25",
            "lines": [{"qty": 1}]})
        assert r.status_code == 422

    def test_curator_proposes_and_apply_merges(self):
        r = self.c.post("/api/curator/run")
        assert r.status_code == 200, r.text
        assert r.json()["proposals"] == 1
        props = self.c.get("/api/curator").json()["proposals"]
        p = props[0]
        assert p["kind"] == "merge" and "Organic" not in " ".join(p["names"])
        # nothing changed yet — proposals are not edits: b still stands alone
        before = self.c.get("/api/items/sku-eggs-b").json()
        assert before["pattern"]["purchase_count"] == 1
        r = self.c.post("/api/curator/decide", json={"id": p["id"], "action": "apply"})
        assert r.json()["status"] == "applied", r.text
        # after the merge, b's page reads the group's pattern (2 buys) and
        # the representative carries the Curator's display name
        after = self.c.get("/api/items/sku-eggs-b").json()
        assert after["pattern"]["purchase_count"] == 2
        rep = self.c.get("/api/items/sku-eggs-a").json()
        assert rep["entry"]["canonical_name"] == "Kirkland Signature Eggs"
        # organic stayed a different product: its pattern is untouched
        org = self.c.get("/api/items/sku-eggs-org").json()
        assert org["pattern"]["purchase_count"] == 1


if __name__ == "__main__":
    unittest.main()


class TestResolver(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        from api import state
        state._save("dictionary.json", {"entries": [
            {"item_id": "sku-x", "sku": "999", "canonical_name": "Mystery Can",
             "resolution": {"status": "unresolved", "candidates": []}}]})
        state._save("receipts.json", [{
            "receipt_id": "r-1", "merchant": "Costco", "purchased_at": "2026-01-01",
            "lines": [{"raw": "BISSELL3857P", "decoded_name": "BISSELL3857P",
                       "sku": "3670779", "qty": 1, "line_total": 99.99,
                       "status": "unverified"}],
            "subtotal": 99.99, "tax": 0, "total": 99.99}])
        r = self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_suggest_line(self):
        r = self.c.post("/api/review/suggest", json={
            "receipt_id": "r-1", "idx": 0,
            "name": "Bissell Little Green MultiClean", "source": "https://example.com/b"})
        assert r.status_code == 200, r.text
        q = self.c.get("/api/review").json()
        assert q["lines"][0]["suggested"]["name"] == "Bissell Little Green MultiClean"
        r = self.c.post("/api/review/suggest", json={
            "receipt_id": "r-1", "idx": 9, "name": "X"})
        assert r.status_code == 404

    def test_suggest_then_settle(self):
        r = self.c.post("/api/review/suggest", json={
            "item_id": "sku-x",
            "candidates": [{"name": "Humm Kombucha 8 ct", "source": "https://example.com/p"}]})
        assert r.status_code == 200, r.text
        q = self.c.get("/api/review").json()
        u = q["unresolved"][0]
        assert u["candidates"] == ["Humm Kombucha 8 ct"]
        assert u["sources"]["Humm Kombucha 8 ct"] == "https://example.com/p"
        # suggesting for a settled or unknown item is refused
        r = self.c.post("/api/review/suggest", json={
            "item_id": "sku-nope", "candidates": [{"name": "X"}]})
        assert r.status_code == 404


class TestDiscountLinesNeverQueue(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_discount_lines_auto(self):
        r = self.c.post("/api/intake/structured", json={
            "merchant": "Costco", "purchased_at": "2026-01-01",
            "lines": [
                {"decoded_name": "Eggs", "qty": 1, "unit_price": 8.0,
                 "line_total": 8.0, "line_type": "item", "confidence": 0.95},
                {"decoded_name": "Instant Savings", "qty": 1, "unit_price": -2.0,
                 "line_total": -2.0, "line_type": "discount", "confidence": 0.5},
                {"decoded_name": "Instant Savings", "raw": "/1234567", "qty": 1,
                 "unit_price": -1.0, "line_total": -1.0, "confidence": 0.1}],
            "subtotal": 5.0, "tax": 0, "total": 5.0})
        assert r.status_code == 200, r.text
        q = self.c.get("/api/review").json()
        self.assertEqual(q["lines"], [])


class TestCuratorReconcile(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        from api import state
        state._save("dictionary.json", {"entries": [
            {"item_id": "a1", "sku": "1", "canonical_name": "White Peach",
             "resolution": {"status": "auto", "candidates": []}},
            {"item_id": "a2", "sku": "2", "canonical_name": "White Peach",
             "resolution": {"status": "auto", "candidates": []}},
            {"item_id": "b1", "sku": "3", "canonical_name": "Organic Blueberries",
             "resolution": {"status": "auto", "candidates": []}},
            {"item_id": "b2", "sku": "4", "canonical_name": "Kirkland Signature Organic Blueberries 3 lb",
             "resolution": {"status": "auto", "candidates": []}}]})
        state._save("curator.json", {"dismissed": [], "proposals": [
            {"id": "p-same", "kind": "merge", "members": ["a1", "a2"],
             "names": ["White Peach", "White Peach"], "into_name": "White Peach",
             "reason": "identical", "status": "pending"},
            {"id": "p-real", "kind": "merge", "members": ["b1", "b2"],
             "names": ["Organic Blueberries", "KS Organic Blueberries 3 lb"],
             "into_name": "Organic Blueberries", "reason": "store brand",
             "status": "pending"}]})
    def test_overtaken_proposals_retire(self):
        from api import curator
        # Root context (no account yet): identical-name entries never
        # form a cluster — they are already one product.
        ids = {i for cl in curator.clusters() for i in cl}
        self.assertNotIn("a1", ids)
        r = self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text
        # After adoption, the API serves the reconciled queue: the
        # overtaken merge retired itself, the real one remains.
        got = self.c.get("/api/curator").json()["proposals"]
        self.assertEqual([p["id"] for p in got], ["p-real"])
