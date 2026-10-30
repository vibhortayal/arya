"""API tokens (agents and scripts): one shared hourly allowance on every
route a token reaches, and a short blocked list for bulk model spend and
changes that touch other people or the account. The app (cookie) is not
affected."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


class TestTokenGuards(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ.pop("ARYA_MCP_RATE", None)
        os.environ.pop("ARYA_TOKEN_GUARDS", None)
        from api import main, deps, demo_guard
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        deps._register_hits.clear()
        demo_guard._token_hits.clear()
        self.app = main.app
        self.c = TestClient(self.app)
        assert self.c.post("/auth/setup", json={"username": "owner@example.com",
                                                "password": "long-password"}).status_code == 200
        self.h = {"Authorization": "Bearer " + self.c.post("/auth/token").json()["token"]}
        self.tok = TestClient(self.app)   # no cookie jar: token only

    def tearDown(self):
        os.environ.pop("ARYA_MCP_RATE", None)
        os.environ.pop("ARYA_TOKEN_GUARDS", None)

    def test_blocked_routes_say_403_for_a_token(self):
        for method, path in [("post", "/api/chat"), ("post", "/api/feedback"),
                             ("post", "/api/group/invite"), ("post", "/api/push/subscribe"),
                             ("post", "/api/settings"), ("post", "/api/powers/share"),
                             ("get", "/api/account/export"), ("post", "/api/quest/avatar/generate"),
                             ("post", "/api/judge/run"), ("post", "/api/list/from-photo"),
                             ("post", "/api/quest/receipts/r-1/delete"),
                             ("post", "/decode/photo")]:
            r = getattr(self.tok, method)(path, headers=self.h)
            assert r.status_code == 403, (path, r.status_code)
            assert "API token" in r.json()["detail"]

    def test_the_app_with_a_cookie_is_not_blocked(self):
        r = self.c.get("/api/account/export")
        assert r.status_code != 403, r.text
        assert self.c.post("/api/settings", json={}).status_code != 403

    def test_everyday_agent_routes_still_work(self):
        assert self.tok.get("/api/lists", headers=self.h).status_code == 200
        assert self.tok.get("/api/settings", headers=self.h).status_code == 200
        r = self.tok.post("/api/list/add", headers=self.h, json={"name": "oat milk"})
        assert r.status_code == 200, r.text
        r = self.tok.post("/api/mcp", headers=self.h, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert r.status_code == 200

    def test_one_allowance_across_routes_with_retry_after(self):
        os.environ["ARYA_MCP_RATE"] = "3"
        for _ in range(3):
            assert self.tok.get("/api/lists", headers=self.h).status_code == 200
        r = self.tok.get("/api/lists", headers=self.h)
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
        # The same allowance covers the Lists API and the connector.
        assert self.tok.get("/api/v1/lists", headers=self.h).status_code == 429
        # The app (cookie) is never limited by it.
        assert self.c.get("/api/lists").status_code == 200

    def test_connector_and_lists_api_are_counted_once(self):
        os.environ["ARYA_MCP_RATE"] = "4"
        rpc = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "get_list", "arguments": {}}}
        for _ in range(2):
            assert self.tok.post("/api/mcp", headers=self.h, json=rpc).status_code == 200
        for _ in range(2):
            assert self.tok.get("/api/v1/lists", headers=self.h).status_code == 200
        assert self.tok.get("/api/v1/lists", headers=self.h).status_code == 429

    def test_switch_lifts_the_blocked_list_only(self):
        os.environ["ARYA_TOKEN_GUARDS"] = "off"
        r = self.tok.get("/api/account/export", headers=self.h)
        assert r.status_code != 403
        from api import demo_guard
        demo_guard._token_hits.clear()
        os.environ["ARYA_MCP_RATE"] = "1"
        assert self.tok.get("/api/lists", headers=self.h).status_code == 200
        assert self.tok.get("/api/lists", headers=self.h).status_code == 429


if __name__ == "__main__":
    unittest.main()
