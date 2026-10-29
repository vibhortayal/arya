"""Connector: API-token auth + order-text intake (Stage 6)."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

ORDER_JSON = json.dumps({
    "merchant": "Instacart — Trader Joe's", "purchased_at": "2026-10-20",
    "lines": [
        {"raw": "Organic Bananas", "decoded_name": "Organic Bananas", "qty": 2,
         "unit_price": 0.69, "line_total": 1.38, "line_type": "item",
         "sku": None, "discount_parent_sku": None, "confidence": 0.95,
         "alternatives": []},
        {"raw": "Whole Milk 1 gal", "decoded_name": "Whole Milk 1 gal", "qty": 1,
         "unit_price": 3.99, "line_total": 3.99, "line_type": "item",
         "sku": None, "discount_parent_sku": None, "confidence": 0.97,
         "alternatives": []}],
    "subtotal": 5.37, "tax": 0.0, "total": 5.37})


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        assert personal and mode == "standard"
        blob = " ".join(m.get("content", "") for m in messages)
        if "Extract this order" in blob:
            return ORDER_JSON, {"input_tokens": 10, "output_tokens": 5}, 0.001
        return json.dumps({"verdicts": []}), {}, 0.0


class TestConnector(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()  # the throttle is process-global; other suites share it
        self.main = main
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_token_lifecycle(self):
        assert self.c.get("/api/home").status_code == 200  # session works
        self.c.post("/auth/logout")
        assert self.c.get("/api/home").status_code == 401
        r = self.c.post("/auth/login", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200
        tok = self.c.post("/auth/token").json()["token"]
        assert tok.startswith("arya_")
        assert self.c.get("/auth/token").json()["has_token"] is True
        bare = TestClient(self.main.app)
        h = {"Authorization": f"Bearer {tok}"}
        assert bare.get("/api/home", headers=h).status_code == 200
        assert bare.get("/api/home",
                        headers={"Authorization": "Bearer arya_wrong"}).status_code == 401
        r = bare.post("/api/intake/order-text", headers=h, json={
            "text": "Instacart order confirmation for Trader Joe's, delivered Oct 20, 2026. "
                    "2 Organic Bananas $1.38, 1 Whole Milk 1 gal $3.99. Subtotal $5.37."})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["merchant"] == "Instacart — Trader Joe's"
        assert body["lines"] == 2 and body["totals_reconcile"] is True
        self.c.delete("/auth/token")
        assert bare.get("/api/home", headers=h).status_code == 401

    def test_token_hash_only_on_disk(self):
        from api import auth
        tok = auth.new_api_token("owner@example.com")
        raw = open(os.path.join(os.environ["ARYA_DATA_DIR"], "api_tokens.json")).read()
        assert tok not in raw  # only the SHA-256 hash is stored
        assert auth.api_token_user(tok) == "owner@example.com"
        auth.revoke_api_tokens("owner@example.com")
        assert auth.api_token_user(tok) is None


if __name__ == "__main__":
    unittest.main()
