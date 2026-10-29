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
        from api import deps
        deps._login_fails.clear()
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

    def test_list_has_no_prepared_cart(self):
        # List overhaul (owner, 2026-10-29): the Prepared cart was one
        # Costco cart that copied the list under every list. It is gone.
        from tests.frontend import app
        js = app()
        assert "paintCart" not in js and "/api/cart/approve" not in js
        assert "Prepared cart" not in js and 'id="cart"' not in js


if __name__ == "__main__":
    unittest.main()
