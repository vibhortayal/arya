"""Groups (owner, 2026-10-29): people who shop for one home share one
set of lists and see each other's receipts. Leaving copies the lists,
takes the leaver's own receipts, and the analysis recomputes."""
import json, os, tempfile, time, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

from api import groups, state
from api.decode.service import normalize_costco_json

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "golden")


def _receipt(rid, day):
    with open(os.path.join(GOLDEN, "synthetic-costco-receipt.json")) as fh:
        obj = json.load(fh)
    obj["transactionBarcode"] = rid
    r = normalize_costco_json(obj)
    r["receipt_id"] = rid
    r["purchased_at"] = day
    return r


class GroupsBase(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_GROUPS"] = "1"
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth, deps
        from api.routes import groups as group_routes
        deps._login_fails.clear()
        group_routes._code_tries.clear()
        self.c = {}
        for i, name in enumerate(("alice@example.com", "bob", "carol")):
            c = TestClient(main.app)
            if i == 0:
                r = c.post("/auth/setup", json={"username": name, "password": "pw-" + name})
            else:
                auth.create_user(name, "pw-" + name)
                r = c.post("/auth/login", json={"username": name, "password": "pw-" + name})
            assert r.status_code == 200, r.text
            self.c[name.split("@")[0]] = c

    def tearDown(self):
        os.environ.pop("ARYA_GROUPS", None)

    def file(self, user, *rs):
        with state.as_user(user):
            state.add_receipts(list(rs))

    def items(self, who):
        return {i["name"]: i for i in self.c[who].get("/api/home").json()["list"]["items"]
                if i.get("on_list")}

    def make_group(self):
        a = self.c["alice"]
        r = a.post("/api/group", json={"name": "Sharma home"})
        self.assertEqual(r.status_code, 200, r.text)
        return a.post("/api/group/invite").json()["code"]


class TestFlag(GroupsBase):
    def test_off_means_no_groups(self):
        os.environ["ARYA_GROUPS"] = "0"
        a = self.c["alice"]
        self.assertEqual(a.get("/api/group").json(), {"enabled": False, "group": None})
        self.assertEqual(a.post("/api/group", json={"name": "x"}).status_code, 404)

    def test_demo_has_no_group(self):
        from fastapi.testclient import TestClient
        import api.main as main
        d = TestClient(main.app)
        d.post("/auth/demo")
        self.assertFalse(d.get("/api/group").json()["enabled"])
        self.assertEqual(d.post("/api/group", json={"name": "x"}).status_code, 403)


class TestJoinAndShare(GroupsBase):
    def test_create_invite_join_shares_lists(self):
        a, b = self.c["alice"], self.c["bob"]
        costco = a.post("/api/lists", json={"name": "Costco"}).json()
        a.post("/api/list/add", json={"name": "Paper towels", "list_id": costco["id"]})
        # Bob has his own "costco" list with one thing on it.
        bc = b.post("/api/lists", json={"name": "costco"}).json()
        b.post("/api/list/add", json={"name": "Batteries", "list_id": bc["id"]})
        b.post("/api/list/add", json={"name": "Basil"})

        code = self.make_group()
        self.assertEqual(len(code), groups.CODE_LEN)
        p = b.get("/api/group/preview", params={"code": code.lower()}).json()
        self.assertEqual((p["name"], p["invited_by"], p["people"], p["lists"]),
                         ("Sharma home", "alice", 1, 1))
        r = b.post("/api/group/join", json={"code": code})
        self.assertEqual(r.status_code, 200, r.text)
        g = r.json()["group"]
        self.assertEqual([m["handle"] for m in g["members"]], ["alice", "bob"])
        self.assertTrue(g["members"][0]["owner"])

        # Same-named lists merged; Bob's items followed him in.
        for who in ("alice", "bob"):
            lists = self.c[who].get("/api/lists").json()["lists"]
            self.assertEqual([l["name"] for l in lists], ["Costco"])
            its = self.items(who)
            self.assertEqual(set(its), {"Paper towels", "Batteries", "Basil"})
            self.assertEqual(its["Batteries"]["list"], costco["id"])

        # An add from one phone shows on the other.
        b.post("/api/list/add", json={"name": "Hummus", "list_id": costco["id"]})
        self.assertIn("Hummus", self.items("alice"))
        recent = a.get("/api/group").json()["recent"]
        self.assertEqual(recent[costco["id"]]["by"], "bob")
        self.assertEqual(recent[costco["id"]]["name"], "Hummus")
        # Your own changes are not news to you.
        self.assertIsNone(b.get("/api/group").json()["recent"].get(costco["id"]))

    def test_receipts_seen_by_all_owned_by_filer(self):
        a, b = self.c["alice"], self.c["bob"]
        self.file("alice@example.com", _receipt("A-1", "2026-10-01"))
        self.file("bob", _receipt("B-1", "2026-10-08"))
        code = self.make_group()
        b.post("/api/group/join", json={"code": code})

        rs = {r["receipt_id"]: r for r in a.get("/api/quest/receipts").json()["receipts"]}
        self.assertEqual(set(rs), {"A-1", "B-1"})
        self.assertEqual((rs["B-1"]["by"], rs["B-1"]["mine"]), ("bob", False))
        self.assertEqual((rs["A-1"]["by"], rs["A-1"]["mine"]), ("alice", True))
        self.assertEqual(a.get("/api/dashboard").json()["trip_count"], 2)
        # The handle never leaks the email.
        self.assertNotIn("example.com", json.dumps(b.get("/api/quest/receipts").json()))
        self.assertNotIn("example.com", json.dumps(b.get("/api/group").json()))

        # Alice can see Bob's receipt but only Bob can delete it.
        r = a.post("/api/quest/receipts/B-1/delete")
        self.assertEqual(r.status_code, 403)
        self.assertIn("@bob", r.json()["detail"])
        # A line fix from Alice lands in Bob's own store.
        with state.as_user("alice@example.com", groups.group_id_for("alice@example.com")):
            state.update_receipt_line("B-1", 0, {"status": "manual"})
        with state.as_user("bob"):
            self.assertEqual(state.own_receipts()[0]["lines"][0]["status"], "manual")
        # Filing a receipt someone else already filed does nothing.
        with state.as_user("alice@example.com", groups.group_id_for("alice@example.com")):
            self.assertEqual(state.add_receipts([_receipt("B-1", "2026-10-08")]), 0)
            self.assertEqual(len(state.own_receipts()), 1)

    def test_wrong_expired_full_and_already_in(self):
        a, b, c = self.c["alice"], self.c["bob"], self.c["carol"]
        code = self.make_group()
        self.assertEqual(b.post("/api/group/join", json={"code": "ZZZZZZ"}).status_code, 404)
        self.assertEqual(b.get("/api/group/preview", params={"code": "AB"}).status_code, 404)
        # A new code replaces the old one.
        code2 = b.post("/api/group/invite").status_code
        self.assertEqual(code2, 404)  # Bob is not in a group yet
        self.assertEqual(a.post("/api/group/invite").json()["code"], code)  # reopening keeps it
        new = a.post("/api/group/invite", json={"new": True}).json()["code"]
        self.assertNotEqual(new, code)
        self.assertEqual(b.post("/api/group/join", json={"code": code}).status_code, 404)
        self.assertEqual(b.post("/api/group/join", json={"code": new}).status_code, 200)
        # One code, one person: Bob's claim used it up.
        r = c.post("/api/group/join", json={"code": new})
        self.assertEqual(r.status_code, 410)
        self.assertIn("already used", r.json()["detail"])
        from fastapi.testclient import TestClient
        anon = TestClient(c.app)
        self.assertEqual(anon.get(f"/auth/group-invite/{new}").json()["status"], "used")
        self.assertEqual(anon.get("/auth/group-invite/QQQQQQ").status_code, 404)
        # Already in a group: a clear "leave it first", at preview and join.
        another = a.post("/api/group/invite").json()["code"]
        self.assertNotEqual(another, new)
        pub = TestClient(c.app).get(f"/auth/group-invite/{another}").json()
        self.assertEqual(set(pub), {"group_name", "inviter_handle", "member_count", "status"})
        self.assertEqual((pub["status"], pub["member_count"]), ("ok", 2))
        r = b.post("/api/group/join", json={"code": another})
        self.assertEqual(r.status_code, 409)
        self.assertIn("leave it first", r.json()["detail"])
        r = b.get("/api/group/preview", params={"code": another})
        self.assertEqual(r.status_code, 409)
        self.assertIn("Leave group", r.json()["detail"])
        self.assertEqual(b.post("/api/group", json={"name": "Other"}).status_code, 400)
        # Expired.
        reg = groups._registry()
        gid = reg["member_of"]["bob"]
        reg["groups"][gid]["invite"]["expires"] = int(time.time()) - 1
        groups._save_registry(reg)
        r = c.post("/api/group/join", json={"code": another})
        self.assertEqual(r.status_code, 410)
        self.assertIn("expired", r.json()["detail"])
        # Full.
        new = a.post("/api/group/invite", json={"new": True}).json()["code"]
        old_max = groups.MAX_MEMBERS
        groups.MAX_MEMBERS = 2
        try:
            r = c.post("/api/group/join", json={"code": new})
            self.assertEqual(r.status_code, 400)
            self.assertIn("full", r.json()["detail"])
        finally:
            groups.MAX_MEMBERS = old_max

    def test_removed_member_is_told_once(self):
        a, b = self.c["alice"], self.c["bob"]
        code = self.make_group()
        self.assertEqual(b.post("/api/group/join", json={"code": code}).status_code, 200)
        self.assertEqual(a.post("/api/group/remove", json={"handle": "bob"}).status_code, 200)
        first = b.get("/api/group").json()
        self.assertIsNone(first["group"])
        self.assertTrue(first["removed_from"]["name"])
        self.assertTrue(first["removed_from"]["at"])
        # Joining a group again clears it.
        code = a.post("/api/group/invite").json()["code"]
        self.assertEqual(b.post("/api/group/join", json={"code": code}).status_code, 200)
        self.assertEqual(b.post("/api/group/leave").status_code, 200)
        self.assertNotIn("removed_from", b.get("/api/group").json())

    def test_wrong_codes_are_rate_limited(self):
        b = self.c["bob"]
        self.make_group()
        codes = [b.post("/api/group/join", json={"code": "QQQQQQ"}).status_code
                 for _ in range(22)]
        self.assertEqual(codes[-1], 429)

    def test_bad_names(self):
        a = self.c["alice"]
        self.assertEqual(a.post("/api/group", json={"name": "   "}).status_code, 400)
        r = a.post("/api/group", json={"name": "x" * 90})
        self.assertEqual(len(r.json()["group"]["name"]), groups.MAX_NAME)
        r = a.post("/api/group/rename", json={"name": "Home"})
        self.assertEqual(r.json()["group"]["name"], "Home")


class TestLeave(GroupsBase):
    def setUp(self):
        super().setUp()
        a, b = self.c["alice"], self.c["bob"]
        self.file("alice@example.com", _receipt("A-1", "2026-10-01"))
        self.file("bob", _receipt("B-1", "2026-10-08"), _receipt("B-2", "2026-10-15"))
        code = self.make_group()
        b.post("/api/group/join", json={"code": code})
        self.costco = a.post("/api/lists", json={"name": "Costco"}).json()
        a.post("/api/list/add", json={"name": "Eggs", "list_id": self.costco["id"]})

    def test_leave_preview_counts(self):
        p = self.c["bob"].get("/api/group/leave-preview").json()
        self.assertEqual((p["my_receipts"], p["other_receipts"]), (2, 1))
        self.assertEqual(p["lists"], ["Costco"])
        self.assertIsNone(p["next_owner"])
        self.assertFalse(p["last_one"])
        p = self.c["alice"].get("/api/group/leave-preview").json()
        self.assertEqual(p["next_owner"], "bob")

    def test_member_leaves_with_copy_of_lists_and_own_receipts(self):
        a, b = self.c["alice"], self.c["bob"]
        r = b.post("/api/group/leave")
        self.assertEqual(r.json(), {"enabled": True, "group": None})
        # Lists duplicated: both sides have Costco with Eggs.
        for who in ("alice", "bob"):
            self.assertEqual([l["name"] for l in self.c[who].get("/api/lists").json()["lists"]],
                             ["Costco"])
            self.assertIn("Eggs", self.items(who))
        # The copies are separate now.
        b.post("/api/list/add", json={"name": "Milk"})
        self.assertNotIn("Milk", self.items("alice"))
        # Receipts went with whoever filed them; analysis recomputed.
        ids = lambda c: {x["receipt_id"] for x in c.get("/api/quest/receipts").json()["receipts"]}
        self.assertEqual(ids(b), {"B-1", "B-2"})
        self.assertEqual(ids(a), {"A-1"})
        self.assertEqual(a.get("/api/dashboard").json()["trip_count"], 1)
        self.assertEqual(b.get("/api/dashboard").json()["trip_count"], 2)
        self.assertNotIn("by", b.get("/api/quest/receipts").json()["receipts"][0])
        self.assertEqual(b.post("/api/group/leave").status_code, 404)

    def test_owner_leaves_then_last_one_closes_group(self):
        a, b = self.c["alice"], self.c["bob"]
        gid = groups.group_id_for("bob")
        a.post("/api/group/leave")
        g = b.get("/api/group").json()["group"]
        self.assertEqual([(m["handle"], m["owner"]) for m in g["members"]], [("bob", True)])
        self.assertIn("Eggs", self.items("bob"))
        self.assertIn("Eggs", self.items("alice"))
        b.post("/api/group/leave")
        self.assertIsNone(groups.group_id_for("bob"))
        self.assertNotIn(gid, groups._registry()["groups"])
        self.assertFalse(os.path.exists(state.group_dir(gid)))
        self.assertIn("Eggs", self.items("bob"))

    def test_owner_removes_member(self):
        a, b, c = self.c["alice"], self.c["bob"], self.c["carol"]
        c.post("/api/group/join", json={"code": a.post("/api/group/invite").json()["code"]})
        self.assertEqual(b.post("/api/group/remove", json={"handle": "carol"}).status_code, 403)
        self.assertEqual(a.post("/api/group/remove", json={"handle": "alice"}).status_code, 400)
        self.assertEqual(a.post("/api/group/remove", json={"handle": "dave"}).status_code, 404)
        r = a.post("/api/group/remove", json={"handle": "@Carol"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([m["handle"] for m in r.json()["group"]["members"]], ["alice", "bob"])
        self.assertIsNone(c.get("/api/group").json()["group"])
        self.assertIn("Eggs", self.items("carol"))

    def test_deleting_an_account_leaves_the_group(self):
        b = self.c["bob"]
        r = b.post("/auth/account/delete", json={"password": "pw-bob"})
        self.assertEqual(r.status_code, 200, r.text)
        g = self.c["alice"].get("/api/group").json()["group"]
        self.assertEqual([m["handle"] for m in g["members"]], ["alice"])
        ids = {x["receipt_id"] for x in self.c["alice"].get("/api/quest/receipts").json()["receipts"]}
        self.assertEqual(ids, {"A-1"})
        self.assertIn("Eggs", self.items("alice"))


if __name__ == "__main__":
    unittest.main()


class TestGroupShell(unittest.TestCase):
    def test_group_screen_ships_with_the_shell(self):
        from tests import frontend
        self.assertIn('"group-join": GroupJoin,', frontend.src("screens/registry.tsx"))
        self.assertIn('id="pf-group"', frontend.src("screens/Profile.tsx"))
        self.assertIn('id="gj-code"', frontend.src("screens/GroupJoin.tsx"))
        self.assertIn('id="rc-who"', frontend.src("screens/Receipts.tsx"))

    def test_invite_link_and_leave_rules_in_the_app(self):
        from tests import frontend
        js = frontend.src("screens/Profile.tsx")
        self.assertIn("/?join=", js)
        self.assertIn("The group keeps its own.", js)
        self.assertIn("Your {{count}} receipts go with you", js)
        self.assertEqual(frontend.words("settings.yourReceiptsGo_one"), "Your {{count}} receipt goes with you")
