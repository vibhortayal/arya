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
        from api.routes import mcp_connector
        mcp_connector._mcp_hits.clear()
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

    def test_hardening(self):
        # Non-string method is an invalid request, not a 500.
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": 5}, self.token)
        assert r.status_code == 200 and r.json()["error"]["code"] == -32600
        # checked must be a real boolean ("false" the string is not False).
        call(self.c, self.token, "add_items", {"items": ["eggs"]})
        res = call(self.c, self.token, "check_item",
                   {"name": "eggs", "checked": "false"})
        assert res["isError"]
        # Receipt line and body caps.
        line = {"decoded_name": "x", "line_total": 1}
        res = call(self.c, self.token, "file_receipt", {
            "merchant": "m", "purchased_at": "2026-10-28",
            "lines": [line] * 201})
        assert res["isError"]
        r = self.c.post("/api/mcp", content=b" " * (256 * 1024 + 1),
                        headers={"Authorization": f"Bearer {self.token}"})
        assert r.status_code == 413
        # Tools carry read-only / non-destructive hints.
        tools = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                    self.token).json()["result"]["tools"]
        assert all("annotations" in t for t in tools)

    def test_tool_call_rate_limit(self):
        with mock.patch.dict(os.environ, {"ARYA_MCP_RATE": "3"}):
            for _ in range(3):
                assert not call(self.c, self.token, "get_list")["isError"]
            res = call(self.c, self.token, "get_list")
            assert res["isError"] and "too many" in res["content"][0]["text"]
            # Protocol messages (not tool calls) are not throttled.
            r = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                    self.token)
            assert "result" in r.json()


if __name__ == "__main__":
    unittest.main()


class TestMcpReviewFixes(TestMcp):
    """MCP code review (2026-11-01, /mnt/project-files/mcp-review/MCP-REVIEW.md)."""

    def _receipt(self, **kw):
        args = {"merchant": "Trader Joe's", "purchased_at": "2026-10-28",
                "lines": [{"decoded_name": "Eggs", "line_total": 3.00}], "total": 3.00}
        args.update(kw)
        return call(self.c, self.token, "file_receipt", args)

    def test_file_receipt_obeys_spend_limits_but_still_files(self):
        from fastapi import HTTPException
        from api import state
        with mock.patch("api.routes.mcp_connector._budget_guard",
                        side_effect=HTTPException(503, "daily model budget reached")), \
                mock.patch.object(state, "judge_pending") as judge:
            out = self._receipt()
        self.assertFalse(out.get("isError"), out)
        data = json.loads(out["content"][0]["text"])
        self.assertIn("daily model budget reached", data["note"])
        judge.assert_not_called()
        got = json.loads(call(self.c, self.token, "get_receipts")["content"][0]["text"])
        self.assertEqual(len(got["receipts"]), 1)

    def test_file_receipt_judges_when_allowed(self):
        from api import state
        with mock.patch.object(state, "judge_pending") as judge:
            self._receipt()
        judge.assert_called_once()

    def test_get_list_leaves_out_suggestions_and_gives_qty(self):
        from api import state
        fake = {"smart_list": {"items": [
            {"item_id": "milk", "name": "Milk", "on_list": True, "qty": 2, "unit": "gal"},
            {"item_id": "bananas", "name": "Bananas", "on_list": False}]}}
        with mock.patch.object(state, "derived", return_value=fake):
            data = json.loads(call(self.c, self.token, "get_list")["content"][0]["text"])
            names = [i["name"] for i in data["items"]]
            self.assertEqual(names, ["Milk"])
            self.assertEqual((data["items"][0]["qty"], data["items"][0]["unit"]), (2, "gal"))
            out = call(self.c, self.token, "check_item", {"name": "Bananas"})
            self.assertTrue(out.get("isError"), out)

    def test_bad_number_is_a_tool_error_not_500(self):
        out = self._receipt(subtotal=[1, 2])
        self.assertTrue(out.get("isError"), out)

    def test_http_refusal_and_crash_become_tool_errors(self):
        from fastapi import HTTPException
        from api.routes import mcp_connector
        with mock.patch.dict(mcp_connector._MCP_HANDLERS,
                             {"get_snapshot": mock.Mock(side_effect=HTTPException(503, "paused"))}):
            out = call(self.c, self.token, "get_snapshot")
            self.assertTrue(out["isError"])
            self.assertIn("paused", out["content"][0]["text"])
        with mock.patch.dict(mcp_connector._MCP_HANDLERS,
                             {"get_snapshot": mock.Mock(side_effect=KeyError("x"))}):
            out = call(self.c, self.token, "get_snapshot")
            self.assertTrue(out["isError"])
            self.assertIn("something went wrong", out["content"][0]["text"])

    def test_401_says_bearer_and_initialize_has_instructions(self):
        anon = TestClient(self.c.app)
        r = rpc(anon, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.headers.get("www-authenticate"), "Bearer")
        r = rpc(self.c, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, self.token)
        self.assertIn("get_list", r.json()["result"]["instructions"])

    def test_token_cannot_start_bulk_reads_or_unfreeze(self):
        h = {"Authorization": f"Bearer {self.token}"}
        anon = TestClient(self.c.app)
        self.assertEqual(anon.post("/api/receipts/jobs", headers=h, json={}).status_code, 403)
        self.assertEqual(anon.post("/api/usage/unfreeze", headers=h, json={}).status_code, 403)

    def test_demo_mcp_shares_the_per_ip_door_cap(self):
        from api import demo_guard
        self.assertTrue(demo_guard._demo_live_door("/api/mcp"))
