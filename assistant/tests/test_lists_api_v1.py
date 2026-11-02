"""Open Lists API v1 (/api/v1): bearer-token reads and writes of the
account's own lists, export and import. See docs/API.md."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


class V1Case(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ.pop("ARYA_MCP_RATE", None)
        from api import main, deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        deps._register_hits.clear()
        from api.routes import mcp_connector
        mcp_connector._mcp_hits.clear()
        self.app = main.app
        self.c = TestClient(self.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        self.token = self.c.post("/auth/token").json()["token"]
        self.h = {"Authorization": f"Bearer {self.token}"}
        # The API is bearer-only: a client with no cookie jar.
        self.api = TestClient(self.app)

    def get(self, path, **k):
        return self.api.get("/api/v1" + path, headers=self.h, **k)

    def post(self, path, **k):
        return self.api.post("/api/v1" + path, headers=self.h, **k)

    def make_list(self, name="Costco"):
        r = self.c.post("/api/lists", json={"name": name, "stores": []})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def add(self, list_id, *names):
        r = self.post(f"/lists/{list_id}/items", json={"items": list(names)})
        assert r.status_code == 200, r.text
        return r.json()


class TestAuth(V1Case):
    def test_missing_and_invalid_token(self):
        r = self.api.get("/api/v1/lists")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"
        r = self.api.get("/api/v1/lists", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401

    def test_cookie_session_is_not_enough(self):
        assert self.c.get("/api/v1/lists").status_code == 401

    def test_schema_is_public(self):
        r = self.api.get("/api/v1/openapi.json")
        assert r.status_code == 200
        assert "/lists/{list_id}/items" in r.json()["paths"]

    def test_other_account_sees_only_its_own(self):
        lid = self.make_list("Mine")
        self.add(lid, "oat milk")
        other = TestClient(self.app)
        r = other.post("/auth/register", json={"username": "second@example.com",
                                               "password": "long-password"})
        if r.status_code != 200:   # registration may be closed in this build
            from api import auth as _auth
            _auth.create_user("second@example.com", "long-password")
            r = other.post("/auth/login", json={"username": "second@example.com",
                                                "password": "long-password"})
        assert r.status_code == 200, r.text
        tok2 = other.post("/auth/token").json()["token"]
        h2 = {"Authorization": f"Bearer {tok2}"}
        names = [l["name"] for l in
                 self.api.get("/api/v1/lists", headers=h2).json()]
        assert "Mine" not in names
        assert self.api.get(f"/api/v1/lists/{lid}", headers=h2).status_code == 404
        item_id = self.get(f"/lists/{lid}").json()["items"][0]["id"]
        assert self.api.delete(f"/api/v1/items/{item_id}", headers=h2).status_code == 404
        assert self.get(f"/lists/{lid}").json()["items"]   # still there


class TestReadAndAdd(V1Case):
    def test_lists_and_open_count(self):
        lid = self.make_list()
        out = self.get("/lists").json()
        assert [l["id"] for l in out] == ["unfiled", lid]
        assert set(out[1]) == {"id", "name", "stores", "open_count"}
        self.add(lid, "milk", "eggs")
        out = {l["id"]: l for l in self.get("/lists").json()}
        assert out[lid]["open_count"] == 2

    def test_get_list_shape(self):
        lid = self.make_list()
        self.add(lid, "milk")
        body = self.get(f"/lists/{lid}").json()
        item = body["items"][0]
        assert set(item) == {"id", "name", "qty", "unit", "checked", "aisle",
                             "added_at", "list_id"}
        assert item["name"] == "milk" and item["checked"] is False
        assert item["aisle"] is None   # Arya's own aisle guess is never shown
        assert item["added_at"].endswith("Z")
        assert self.get("/lists/l-nope").status_code == 404

    def test_add_structured_with_qty_unit_aisle(self):
        lid = self.make_list()
        out = self.add_obj(lid, [{"name": "rice", "qty": 2, "unit": "kg",
                                  "aisle": "Pantry"}, "eggs"])
        assert out["added"] == 2
        rice = next(i for i in out["items"] if i["name"] == "rice")
        assert (rice["qty"], rice["unit"], rice["aisle"]) == (2, "kg", "Pantry")

    def add_obj(self, lid, items):
        r = self.post(f"/lists/{lid}/items", json={"items": items})
        assert r.status_code == 200, r.text
        return r.json()

    def test_add_from_text(self):
        lid = self.make_list()
        r = self.post(f"/lists/{lid}/items", json={"text": "milk\neggs x 3, bread"})
        assert r.status_code == 200, r.text
        names = {i["name"]: i for i in r.json()["items"]}
        assert set(names) == {"milk", "eggs", "bread"}
        assert names["eggs"]["qty"] == 3

    def test_add_text_drops_a_sentence_whole(self):
        lid = self.make_list()
        text = ("milk\neggs x 3\nbread\n42\n"
                "This is a long sentence that is not an item at all, really.")
        r = self.post(f"/lists/{lid}/items", json={"text": text})
        assert r.status_code == 200, r.text
        assert {i["name"] for i in r.json()["items"]} == {"milk", "eggs", "bread"}
        assert "42" in r.json()["skipped"]
        assert any(s.startswith("This is a long") for s in r.json()["skipped"])

    def test_add_dedups_with_already_reply(self):
        lid = self.make_list()
        self.add(lid, "milk")
        out = self.add(lid, "milk")
        assert out["added"] == 0 and out["already"] == 1
        assert out["already_names"][0]["name"] == "milk"
        assert len(self.get(f"/lists/{lid}").json()["items"]) == 1

    def test_add_does_not_move_an_item_from_another_list(self):
        a, b = self.make_list("Costco"), self.make_list("Trader Joe's")
        self.add(a, "milk")
        out = self.add(b, "milk")
        assert out["added"] == 0 and out["items"] == []
        assert out["also_on"] == [{"name": "milk", "item_id": "manual-milk",
                                   "list_id": a, "list_name": "Costco"}]
        assert [i["name"] for i in self.get(f"/lists/{a}").json()["items"]] == ["milk"]
        assert not self.get(f"/lists/{b}").json()["items"]
        # Other names in the same call still go in.
        out = self.add(b, "milk", "eggs")
        assert [i["name"] for i in out["items"]] == ["eggs"] and out["added"] == 1

    def test_add_to_unfiled(self):
        # Every item on a list (owner, 2026-11-02): no lists, nothing added.
        r = self.post("/lists/unfiled/items", json={"items": ["salt"]})
        assert r.status_code == 400 and "make a list" in r.text
        # With one list, an unfiled add files there.
        lid = self.make_list()
        self.add("unfiled", "salt")
        assert [i["name"] for i in self.get(f"/lists/{lid}").json()["items"]] == ["salt"]
        # With two, the caller must say which.
        self.make_list("Trader Joe's")
        r = self.post("/lists/unfiled/items", json={"items": ["pepper"]})
        assert r.status_code == 400 and "Costco" in r.text

    def test_add_needs_items_or_text_not_both(self):
        lid = self.make_list()
        assert self.post(f"/lists/{lid}/items", json={}).status_code == 400
        assert self.post(f"/lists/{lid}/items",
                         json={"items": ["a"], "text": "b"}).status_code == 400
        r = self.post(f"/lists/{lid}/items", json={"items": ["a"], "bogus": 1})
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"

    def test_add_caps(self):
        lid = self.make_list()
        r = self.post(f"/lists/{lid}/items", json={"items": ["x"] * 51})
        assert r.status_code == 400

    def test_oversize_body_rejected(self):
        lid = self.make_list()
        r = self.api.post(f"/api/v1/lists/{lid}/items", headers=self.h,
                          content=b"x" * (256 * 1024 + 1))
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "too_large"


class TestChangeAndDelete(V1Case):
    def setUp(self):
        super().setUp()
        self.lid = self.make_list("Costco")
        self.other = self.make_list("Indian Store")
        self.iid = self.add(self.lid, "milk")["items"][0]["id"]

    def patch(self, **body):
        return self.api.patch(f"/api/v1/items/{self.iid}", headers=self.h, json=body)

    def test_check_and_uncheck(self):
        r = self.patch(checked=True)
        assert r.status_code == 200 and r.json()["checked"] is True
        assert self.get("/lists").json()[1]["open_count"] == 0
        assert self.patch(checked=False).json()["checked"] is False

    def test_qty_unit_aisle(self):
        r = self.patch(qty=3)
        assert r.json()["qty"] == 3
        r = self.patch(unit="gal", qty=1.5)
        assert (r.json()["qty"], r.json()["unit"]) == (1.5, "gal")
        assert self.patch(unit="").json()["unit"] == ""
        assert self.patch(aisle="Refrigerated").json()["aisle"] == "Refrigerated"
        assert self.patch(aisle="").json()["aisle"] is None

    def test_move_between_lists_and_to_unfiled(self):
        assert self.patch(list_id=self.other).json()["list_id"] == self.other
        assert not self.get(f"/lists/{self.lid}").json()["items"]
        assert self.patch(list_id=None).json()["list_id"] == "unfiled"
        assert self.patch(list_id="l-nope").status_code == 404

    def test_bad_patches_write_nothing(self):
        assert self.patch().status_code == 400
        assert self.patch(color="red").status_code == 400
        assert self.patch(checked=True, list_id="l-nope").status_code == 404
        assert self.get(f"/lists/{self.lid}").json()["items"][0]["checked"] is False
        r = self.api.patch("/api/v1/items/no-such", headers=self.h, json={"checked": True})
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"

    def test_delete(self):
        r = self.api.delete(f"/api/v1/items/{self.iid}", headers=self.h)
        assert r.status_code == 200 and r.json() == {"deleted": self.iid}
        assert not self.get(f"/lists/{self.lid}").json()["items"]
        assert self.api.delete(f"/api/v1/items/{self.iid}",
                               headers=self.h).status_code == 404


class TestExportImport(V1Case):
    def seed(self):
        lid = self.make_list("Costco")
        self.add_rich(lid)
        return lid

    def add_rich(self, lid):
        self.post(f"/lists/{lid}/items", json={"items": [
            {"name": "rice", "qty": 2, "unit": "kg", "aisle": "Pantry"},
            {"name": "eggs", "qty": 12}, "milk"]})
        iid = next(i["id"] for i in self.get(f"/lists/{lid}").json()["items"]
                   if i["name"] == "milk")
        self.api.patch(f"/api/v1/items/{iid}", headers=self.h, json={"checked": True})

    def test_export_json(self):
        lid = self.seed()
        out = self.get(f"/lists/{lid}/export?format=json").json()
        assert out["list"]["name"] == "Costco" and len(out["items"]) == 3

    def test_export_text_is_a_checklist(self):
        lid = self.seed()
        r = self.get(f"/lists/{lid}/export?format=text")
        assert r.headers["content-type"].startswith("text/plain")
        lines = r.text.strip().splitlines()
        assert "☐ rice 2 kg" in lines and "☐ eggs x 12" in lines and "☑ milk" in lines

    def test_export_csv_columns(self):
        lid = self.seed()
        r = self.get(f"/lists/{lid}/export?format=csv")
        assert r.headers["content-type"].startswith("text/csv")
        rows = r.text.strip().splitlines()
        assert rows[0] == "name,qty,unit,checked,department,list"
        assert "rice,2,kg,false,Pantry,Costco" in rows
        assert self.get(f"/lists/{lid}/export?format=xml").status_code == 400

    def _roundtrip(self, fmt, ctype):
        lid = self.seed()
        data = self.get(f"/lists/{lid}/export?format={fmt}").text
        for i in self.get(f"/lists/{lid}").json()["items"]:
            self.api.delete(f"/api/v1/items/{i['id']}", headers=self.h)
        self.c.post("/api/lists/delete", json={"id": lid})
        r = self.api.post(f"/api/v1/lists/import?list=Costco{'&format=' + fmt}",
                          headers={**self.h, "Content-Type": ctype},
                          content=data.encode())
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["created"] == 3 and out["skipped"] == 0
        new = out["lists"][0]["id"]
        items = {i["name"]: i for i in self.get(f"/lists/{new}").json()["items"]}
        assert items["rice"]["qty"] == 2 and items["rice"]["unit"] == "kg"
        assert items["eggs"]["qty"] == 12
        assert items["milk"]["checked"] is True
        return items

    def test_csv_round_trip(self):
        items = self._roundtrip("csv", "text/csv")
        assert items["rice"]["aisle"] == "Pantry"

    def test_text_round_trip(self):
        self._roundtrip("text", "text/plain")

    def test_import_counts_skips_and_fills_existing_list(self):
        lid = self.make_list("Party")
        self.add(lid, "chips")
        r = self.api.post("/api/v1/lists/import?list=party", headers=self.h,
                          content="chips\nsalsa\n42\n".encode())
        out = r.json()
        assert out["created"] == 1 and out["skipped"] == 2
        assert out["lists"][0]["id"] == lid
        assert len(self.get("/lists").json()) == 2   # no new list made

    def test_import_csv_makes_lists_from_list_column(self):
        csv_text = "name,list\nsoap,Household\nbread,Bakery\n"
        r = self.api.post("/api/v1/lists/import", headers={**self.h, "Content-Type": "text/csv"},
                          content=csv_text.encode())
        assert r.json()["created"] == 2
        names = [l["name"] for l in self.get("/lists").json()]
        assert "Household" in names and "Bakery" in names

    def test_import_csv_needs_name_column(self):
        r = self.api.post("/api/v1/lists/import?format=csv", headers=self.h,
                          content=b"item,qty\nmilk,1\n")
        assert r.status_code == 400

    def test_import_rejects_oversize(self):
        r = self.api.post("/api/v1/lists/import", headers=self.h,
                          content=b"milk\n" * 60000)
        assert r.status_code == 413


def file_receipt(client, headers, merchant, day, lines, rid=None):
    args = {"merchant": merchant, "purchased_at": day, "lines": lines}
    if rid:
        args["receipt_id"] = rid
    r = client.post("/api/mcp", headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "file_receipt", "arguments": args}})
    assert r.status_code == 200 and not r.json()["result"]["isError"], r.text
    return r.json()["result"]["structuredContent"]["receipt_id"]


class TestReceiptsAndAnalysis(V1Case):
    def setUp(self):
        super().setUp()
        self.r1 = file_receipt(self.api, self.h, "Costco", "2026-10-01", [
            {"decoded_name": "oat milk", "line_total": 4.5},
            {"decoded_name": "eggs", "line_total": 6.0, "qty": 2},
            {"decoded_name": "=HYPERLINK(\"x\")", "line_total": 1.0}], rid="r-1")
        self.r2 = file_receipt(self.api, self.h, "Trader Joe's", "2026-10-15", [
            {"decoded_name": "oat milk", "line_total": 4.0},
            {"decoded_name": "oat milk", "line_total": -4.0, "line_type": "return"}], rid="r-2")

    def test_list_newest_first_and_paged(self):
        out = self.get("/receipts").json()
        assert out["total"] == 2
        assert [r["id"] for r in out["receipts"]] == [self.r2, self.r1]
        assert set(out["receipts"][0]) == {"id", "merchant", "date", "total", "subtotal",
                                           "tax", "items", "reconciles", "has_photo"}
        assert len(self.get("/receipts?limit=1&offset=1").json()["receipts"]) == 1

    def test_detail_lines_and_404(self):
        d = self.get(f"/receipts/{self.r2}").json()
        assert [l["line_type"] for l in d["lines"]] == ["item", "return"]
        assert d["lines"][1]["line_total"] == -4.0
        assert self.get("/receipts/nope").status_code == 404

    def test_export_csv_and_json(self):
        r = self.get("/receipts/export?format=csv")
        rows = r.text.strip().splitlines()
        assert rows[0] == "receipt_id,merchant,date,name,qty,unit_price,line_total,line_type"
        assert any(l.startswith("r-1,Costco,2026-10-01,oat milk,") for l in rows)
        assert "\'=HYPERLINK" in r.text.replace("'", "\\'") or "'=HYPERLINK" in r.text
        assert len(self.get("/receipts/export").json()["receipts"]) == 2
        assert self.get("/receipts/export?format=xml").status_code == 400

    def test_delete_receipt(self):
        assert self.api.delete(f"/api/v1/receipts/{self.r1}", headers=self.h).status_code == 200
        assert self.get(f"/receipts/{self.r1}").status_code == 404
        assert self.api.delete(f"/api/v1/receipts/{self.r1}", headers=self.h).status_code == 404

    def test_original_404_without_photo(self):
        assert self.get(f"/receipts/{self.r1}/original").status_code == 404

    def test_spending_and_purchases_are_plain_sums(self):
        s = self.get("/analysis/spending").json()
        assert s["trips"] == 2 and s["spend_total"] == 11.5
        assert s["by_month"] == {"2026-10": 11.5}
        assert s["by_store"] == {"Costco": 11.5, "Trader Joe's": 0.0}
        assert s["returns_total"] == 4.0
        p = self.get("/analysis/purchases").json()["items"]
        top = next(i for i in p if i["name"] == "oat milk")
        assert top["times_bought"] == 2 and top["last_bought"] == "2026-10-15"

    def test_other_account_sees_none_of_it(self):
        from api import auth as _auth
        _auth.create_user("second@example.com", "long-password")
        other = TestClient(self.app)
        assert other.post("/auth/login", json={"username": "second@example.com",
                                               "password": "long-password"}).status_code == 200
        h2 = {"Authorization": "Bearer " + other.post("/auth/token").json()["token"]}
        assert self.api.get("/api/v1/receipts", headers=h2).json()["total"] == 0
        assert self.api.get(f"/api/v1/receipts/{self.r1}", headers=h2).status_code == 404
        assert self.api.delete(f"/api/v1/receipts/{self.r1}", headers=h2).status_code == 404
        assert self.api.get("/api/v1/analysis/spending", headers=h2).json()["trips"] == 0
        assert self.get(f"/receipts/{self.r1}").status_code == 200

    def test_token_required(self):
        for path in ("/receipts", "/receipts/export", "/analysis/spending", "/analysis/purchases"):
            assert self.api.get("/api/v1" + path).status_code == 401


class TestSchemaForDevelopers(V1Case):
    """The reference page draws this schema: plain ids, summaries, the
    bearer scheme and the error shape."""

    def spec(self):
        return self.api.get("/api/v1/openapi.json").json()

    def test_every_operation_has_a_plain_id_summary_and_tag(self):
        ids = []
        for path, methods in self.spec()["paths"].items():
            for method, op in methods.items():
                ids.append(op["operationId"])
                self.assertNotIn("_" + method, op["operationId"], (method, path))
                self.assertTrue(op["summary"] and op["description"] and op["tags"], (method, path))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 14)

    def test_bearer_scheme_and_error_responses(self):
        spec = self.spec()
        self.assertEqual(spec["components"]["securitySchemes"]["bearerAuth"]["scheme"], "bearer")
        self.assertEqual(spec["security"], [{"bearerAuth": []}])
        op = spec["paths"]["/lists"]["get"]
        self.assertIn("401", op["responses"])
        self.assertIn("429", op["responses"])

    def test_reference_page_is_public_and_has_no_inline_script(self):
        r = self.c.get("/developers/reference")
        self.assertEqual(r.status_code, 200)
        self.assertIn("/api/v1/openapi.json", r.text)
        import re
        for attrs, body in re.findall(r"<script\b([^>]*)>(.*?)</script>", r.text, re.S):
            self.assertEqual(body.strip(), "")
        self.assertEqual(self.c.get("/vendor/scalar/standalone.js").status_code, 200)


class TestRateLimit(V1Case):
    def test_429_with_retry_after_shared_with_mcp(self):
        os.environ["ARYA_MCP_RATE"] = "3"
        try:
            for _ in range(3):
                assert self.get("/lists").status_code == 200
            r = self.get("/lists")
            assert r.status_code == 429
            assert r.json()["error"]["code"] == "rate_limited"
            assert int(r.headers["Retry-After"]) > 0
        finally:
            os.environ.pop("ARYA_MCP_RATE", None)


if __name__ == "__main__":
    unittest.main()
