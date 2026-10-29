"""Agent connector (MCP): the generic JSON-RPC surface at /api/mcp.
Any MCP-capable assistant connects with the account's API token (the
same token the REST connector uses); Muse Spark is the showcased
client, not a special case (owner, 2026-10-28)."""
import json, os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


def rpc(c, msg, token=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return c.post("/api/mcp", json=msg, headers=h)


def call(c, token, name, args=None, rid=7):
    r = rpc(c, {"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                "params": {"name": name, "arguments": args or {}}}, token)
    assert r.status_code == 200, r.text
    return r.json()["result"]


class TestMcp(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        deps._register_hits.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        tok = self.c.post("/auth/token")
        assert tok.status_code == 200, tok.text
        self.token = tok.json()["token"]

    def test_auth_required(self):
        anon = TestClient(self.c.app)  # no session cookie, no token
        r = rpc(anon, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert r.status_code == 401
        r = rpc(anon, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                token="not-a-token")
        assert r.status_code == 401

    def test_initialize_and_tools_list(self):
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                         "params": {"protocolVersion": "2025-03-26",
                                    "capabilities": {},
                                    "clientInfo": {"name": "test", "version": "0"}}},
                self.token)
        out = r.json()["result"]
        assert out["protocolVersion"] == "2025-03-26"
        assert out["serverInfo"]["name"] == "arya"
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                self.token)
        names = [t["name"] for t in r.json()["result"]["tools"]]
        assert names == ["get_snapshot", "get_list", "add_items",
                         "check_item", "file_receipt", "get_receipts"], names

    def test_add_check_and_list(self):
        # A filed receipt anchors the account's as_of date; check-off
        # is recorded against it (the same rule the REST list uses).
        call(self.c, self.token, "file_receipt", {
            "merchant": "Trader Joe's", "purchased_at": "2026-10-28",
            "lines": [{"decoded_name": "Eggs", "line_total": 3.00, "qty": 1}],
            "subtotal": 3.00, "total": 3.00})
        res = call(self.c, self.token, "add_items", {"items": ["oat milk"]})
        assert not res["isError"]
        assert res["structuredContent"]["added"][0]["name"] == "oat milk"
        lst = call(self.c, self.token, "get_list")["structuredContent"]
        mine = [i for i in lst["items"] if i["name"] == "oat milk"]
        assert mine and mine[0]["checked"] is False
        res = call(self.c, self.token, "check_item", {"name": "Oat Milk"})
        assert res["structuredContent"]["checked"] is True
        lst = call(self.c, self.token, "get_list")["structuredContent"]
        mine = [i for i in lst["items"] if i["name"] == "oat milk"]
        assert mine[0]["checked"] is True
        res = call(self.c, self.token, "check_item", {"name": "not a thing"})
        assert res["isError"] and "not on the list" in res["content"][0]["text"]

    def test_file_receipt_and_reads(self):
        res = call(self.c, self.token, "file_receipt", {
            "merchant": "Trader Joe's", "purchased_at": "2026-10-28",
            "lines": [{"decoded_name": "Oat Milk", "line_total": 4.50, "qty": 1}],
            "subtotal": 4.50, "total": 4.50})
        assert not res["isError"], res
        assert res["structuredContent"]["added"] == 1
        assert res["structuredContent"]["totals_reconcile"] is True
        recs = call(self.c, self.token, "get_receipts")["structuredContent"]
        assert recs["receipts"][0]["merchant"] == "Trader Joe's"
        assert recs["receipts"][0]["total"] == 4.50
        snap = call(self.c, self.token, "get_snapshot")["structuredContent"]
        assert snap["trips"] == 1
        # Spend resolves once the staple judge files the new item in
        # the dictionary — identical to the REST intake door, which
        # shows the same snapshot for the same receipt.

    def test_protocol_edges(self):
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 9, "method": "bogus/method"},
                self.token)
        assert r.json()["error"]["code"] == -32601
        r = rpc(self.c, {"method": "tools/list"}, self.token)  # no jsonrpc tag
        assert r.json()["error"]["code"] == -32600
        r = rpc(self.c, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                self.token)
        assert r.status_code == 202
        res = call(self.c, self.token, "nope_tool")
        assert res["isError"]

    def test_bad_input_is_a_tool_error_not_a_500(self):
        res = call(self.c, self.token, "check_item", {"name": 5})
        assert res["isError"]
        line = {"decoded_name": 5, "line_total": 1}
        res = call(self.c, self.token, "file_receipt", {
            "merchant": "m", "purchased_at": "2026-10-28", "lines": [line]})
        assert res["isError"]
        res = call(self.c, self.token, "add_items", {"items": [None, "  ", "eggs"]})
        assert [a["name"] for a in res["structuredContent"]["added"]] == ["eggs"]
        res = call(self.c, self.token, "add_items", {"items": ["x"] * 51})
        assert res["isError"]
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": "get_list", "arguments": ["x"]}},
                self.token)
        assert r.json()["result"]["isError"]
        recs = call(self.c, self.token, "get_receipts", {"limit": -3})
        assert not recs["isError"]

    def test_receipt_date_must_be_real_and_not_future(self):
        for bad in ("garbage", "2099-01-01", "2026-13-40"):
            res = call(self.c, self.token, "file_receipt", {
                "merchant": "m", "purchased_at": bad,
                "lines": [{"decoded_name": "x", "line_total": 1}]})
            assert res["isError"], bad
        snap = call(self.c, self.token, "get_snapshot")["structuredContent"]
        assert snap["trips"] == 0 and snap["as_of"] is None

    def test_demo_cannot_file_receipts(self):
        demo = TestClient(self.c.app)
        assert demo.post("/auth/demo").status_code == 200
        res = call(demo, None, "file_receipt", {
            "merchant": "m", "purchased_at": "2026-10-28",
            "lines": [{"decoded_name": "x", "line_total": 1}]})
        assert res["isError"] and "real account" in res["content"][0]["text"]
        res = call(demo, None, "add_items", {"items": ["sandbox milk"]})
        assert not res["isError"]

    def test_account_isolation(self):
        call(self.c, self.token, "add_items", {"items": ["owner only item"]})
        other = TestClient(self.c.app)
        with mock.patch.dict(os.environ, {"ARYA_REGISTRATION_OPEN": "1"}):
            r = other.post("/auth/register", json={"username": "two@example.com",
                                                   "password": "long-password"})
        assert r.status_code == 200, r.text
        tok2 = other.post("/auth/token").json()["token"]
        lst = call(other, tok2, "get_list")["structuredContent"]
        assert all(i["name"] != "owner only item" for i in lst["items"])


if __name__ == "__main__":
    unittest.main()
