"""Offline list changes (owner, 2026-11-01): a change queued on the phone
is applied once however often it is replayed, and a queued change older
than the item's last change is skipped (last change wins, per item)."""
import os, time, unittest

from tests.test_groups import GroupsBase
from tests.test_lists_qa_oct30 import fresh, rows
from tests.conftest import one_list


def hdr(op, made_ago_s=0.0, clock_off_s=0.0):
    """A queued change: made `made_ago_s` seconds ago on a phone whose
    clock is `clock_off_s` seconds ahead of the server."""
    now = (time.time() + clock_off_s) * 1000
    return {"X-Arya-Op": op, "X-Arya-Op-At": str(int(now - made_ago_s * 1000)),
            "X-Arya-Op-Sent": str(int(now))}


class TestReplayOnce(unittest.TestCase):
    def setUp(self):
        self.c = fresh(self)

    def test_same_add_twice_adds_once(self):
        a = self.c.post("/api/list/from-text", json={"text": "oat milk"}, headers=hdr("op-add-1", 60))
        self.assertEqual(a.status_code, 200, a.text)
        b = self.c.post("/api/list/from-text", json={"text": "oat milk"}, headers=hdr("op-add-1", 60))
        self.assertEqual(b.status_code, 200)
        self.assertTrue(b.json().get("duplicate"))
        self.assertEqual(b.json()["all_item_ids"], a.json()["all_item_ids"])
        self.assertEqual([n for n in rows(self.c) if n.lower() == "oat milk"], ["oat milk"])

    def test_live_write_with_op_id_is_kept_too(self):
        # A write that timed out on the phone is replayed with the same id.
        iid = self.c.post("/api/list/add", json={"name": "bread"}).json()["item_id"]
        r1 = self.c.post("/api/list/check", json={"item_id": iid, "checked": True}, headers={"X-Arya-Op": "op-t"})
        self.c.post("/api/list/check", json={"item_id": iid, "checked": False})
        r2 = self.c.post("/api/list/check", json={"item_id": iid, "checked": True}, headers={"X-Arya-Op": "op-t"})
        self.assertTrue(r2.json().get("duplicate"))
        self.assertTrue(r1.json()["ok"])
        self.assertFalse(rows(self.c)["bread"].get("checked"))

    def test_different_ops_both_apply(self):
        iid = self.c.post("/api/list/add", json={"name": "eggs"}).json()["item_id"]
        self.c.post("/api/list/check", json={"item_id": iid, "checked": True}, headers=hdr("o1", 30))
        self.c.post("/api/list/check", json={"item_id": iid, "checked": False}, headers=hdr("o2", 20))
        self.assertFalse(rows(self.c)["eggs"].get("checked"))

    def test_failed_write_is_not_kept(self):
        r = self.c.post("/api/list/check", json={}, headers=hdr("bad", 5))
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/list/check", json={}, headers=hdr("bad", 5))
        self.assertEqual(r.status_code, 400)

    def test_ops_are_per_account(self):
        from api import auth
        from fastapi.testclient import TestClient
        from api import main
        self.c.post("/api/list/from-text", json={"text": "rice"}, headers=hdr("shared-id", 5))
        auth.create_user("other", "pw-other-long")
        o = TestClient(main.app)
        o.post("/auth/login", json={"username": "other", "password": "pw-other-long"})
        one_list(o)
        r = o.post("/api/list/from-text", json={"text": "rice"}, headers=hdr("shared-id", 5))
        self.assertFalse(r.json().get("duplicate"))
        self.assertIn("rice", rows(o))


class TestLastChangeWins(GroupsBase):
    def setUp(self):
        super().setUp()
        b = self.c["bob"]
        b.post("/api/group/join", json={"code": self.make_group()})
        one_list(self.c["alice"])  # lists are shared, so Bob's adds file here too
        self.iid = self.c["alice"].post("/api/list/add", json={"name": "milk"}).json()["item_id"]

    def test_older_queued_tick_loses_to_newer_live_untick(self):
        a, b = self.c["alice"], self.c["bob"]
        # Alice ticked milk offline 5 minutes ago; Bob unticked it just now.
        b.post("/api/list/check", json={"item_id": self.iid, "checked": False})
        r = a.post("/api/list/check", json={"item_id": self.iid, "checked": True}, headers=hdr("a-tick", 300))
        self.assertEqual(r.json(), {"ok": True, "stale": True, "item_id": self.iid})
        self.assertFalse(self.items("bob")["milk"].get("checked"))

    def test_newer_queued_change_wins(self):
        a, b = self.c["alice"], self.c["bob"]
        b.post("/api/list/edit", json={"item_id": self.iid, "qty": 2})
        time.sleep(0.01)
        r = a.post("/api/list/check", json={"item_id": self.iid, "checked": True}, headers=hdr("a-new", 0))
        self.assertNotIn("stale", r.json())
        self.assertTrue(self.items("bob")["milk"].get("checked"))

    def test_phone_clock_ahead_still_lines_up(self):
        a, b = self.c["alice"], self.c["bob"]
        b.post("/api/list/check", json={"item_id": self.iid, "checked": False})
        # Alice's phone clock is an hour fast; her tick was made 5 min ago.
        r = a.post("/api/list/check", json={"item_id": self.iid, "checked": True},
                   headers=hdr("a-fast", 300, clock_off_s=3600))
        self.assertTrue(r.json().get("stale"))

    def test_other_items_are_not_blocked(self):
        a, b = self.c["alice"], self.c["bob"]
        other = a.post("/api/list/add", json={"name": "bread"}).json()["item_id"]
        time.sleep(0.01)
        # Bob's later change to milk does not hold back Alice's queued bread tick.
        b.post("/api/list/check", json={"item_id": self.iid, "checked": True})
        r = a.post("/api/list/check", json={"item_id": other, "checked": True}, headers=hdr("a-bread", 0))
        self.assertNotIn("stale", r.json())
        self.assertTrue(self.items("bob")["bread"].get("checked"))

    def test_add_by_name_stamps_the_new_item(self):
        from api import listops, state, groups
        a = self.c["alice"]
        iid = a.post("/api/list/add", json={"name": "bread"}).json()["item_id"]
        with state.as_user("alice@example.com", groups.group_id_for("alice@example.com")):
            self.assertIsNotNone(listops.stamp_of(iid))

    def test_flag_route_is_stamped(self):
        a, b = self.c["alice"], self.c["bob"]
        b.post(f"/api/items/{self.iid}/flag", json={"never": False})
        r = a.post("/api/list/remove", json={"item_id": self.iid}, headers=hdr("a-rm", 120))
        self.assertTrue(r.json().get("stale"))
        self.assertIn("milk", self.items("bob"))


if __name__ == "__main__":
    unittest.main()
