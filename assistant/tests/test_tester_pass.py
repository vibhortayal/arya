"""Live tester pass (2026-10-28) regressions: what a brand-new
account sees. No model calls."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class TestNewAccount(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        main._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "new@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_ask_context_names_typed_items_not_ids(self):
        # tester-a's Ask answer read "manual-milk, manual-eggs": the
        # chat snapshot sent item ids for typed list adds.
        self.c.post("/api/list/from-text", json={"text": "milk, peanut butter"})
        from api import chat_service, state
        state.set_current_user("new@example.com")
        snap = chat_service.snapshot()
        assert snap["on_list"] == ["milk", "peanut butter"], snap["on_list"]
        # Typed items are on the list, not "running low": that is
        # for what the patterns say is due (QA 2026-10-28).
        assert snap["running_low"] == [], snap["running_low"]

    def test_empty_cart_offers_no_approve(self):
        pwa = os.path.join(os.path.dirname(__file__), "..", "pwa", "app.js")
        js = open(pwa, encoding="utf-8").read()
        body = js[js.index("function paintCart"):]
        assert body.index("!c.items.length") < body.index("btn-approve")


if __name__ == "__main__":
    unittest.main()
