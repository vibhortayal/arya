"""Ask Arya sees food dates (owner, 2026-11-01: "What goes bad this
week?" had no data behind it) and the list's own prices first."""
import json, os, shutil, tempfile, unittest
from datetime import date

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient

from tests.test_eyes_chat import seed_demo


class TestUseSoonWindow(unittest.TestCase):
    def test_longer_window_keeps_snoozed_dates(self):
        from api import expiry
        today = date(2026, 11, 1)
        fl = {"a": {"use_by": "2026-11-20", "use_by_snooze": "2026-11-05", "name": "Yogurt"}}
        self.assertEqual(expiry.use_soon(fl, {}, {}, today), [])
        rows = expiry.use_soon(fl, {}, {}, today, ahead=30, skip_snoozed=False)
        self.assertEqual([(r["name"], r["days"]) for r in rows], [("Yogurt", 19)])


class TestAskFactsOrder(unittest.TestCase):
    def test_list_items_lead(self):
        from api import prices
        d = {"entries": [
            {"event_type": "purchase", "store_id": "A", "item_id": f"i{n}", "price": 2.0,
             "qty": 1, "date": f"2026-10-{n + 1:02d}"} for n in range(5)]}
        names = {f"i{n}": f"Item {n}" for n in range(5)}
        got = list(prices.ask_facts(d, names, cap=2, first=["i0", "missing"]))
        self.assertEqual(got, ["Item 0", "Item 4"])


class TestSnapshotDates(unittest.TestCase):
    def setUp(self):
        from api import deps
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_demo(base)
        shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
        import api.main as main
        seen = self.seen = []

        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None, **kw):
                seen.append((messages, kw))
                return json.dumps({"reply": "ok", "actions": []}), {}, 0.01

        deps.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def test_snapshot_carries_dates_and_cache_key(self):
        from api import state
        from api.deps import _d_today
        with state.as_user("owner"):
            iid = next(e["item_id"] for e in state.dictionary()["entries"]
                       if e["canonical_name"].startswith("Greek Yogurt"))
            when = _d_today().fromordinal(_d_today().toordinal() + 3).isoformat()
            state.set_flag(iid, {"use_by": when, "use_by_kind": "use_by",
                                 "use_by_set": _d_today().isoformat()})
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "what goes bad this week?"}]})
        self.assertEqual(r.status_code, 200)
        messages, kw = self.seen[-1]
        self.assertEqual(kw.get("cache_key"), "arya-ask-v1")
        snap = json.loads(messages[1]["content"].split("\n", 1)[1])
        self.assertIn("still_good", snap)
        self.assertEqual(snap["today"], _d_today().isoformat())
        row = next(u for u in snap["use_by"] if u["name"].startswith("Greek Yogurt"))
        self.assertEqual((row["date"], row["days_left"], row["kind"]), (when, 3, "use_by"))


if __name__ == "__main__":
    unittest.main()
