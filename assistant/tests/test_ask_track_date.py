"""Ask sets a Use soon date itself (owner, 2026-11-03).

"Can you add this milk to my use soon list?" used to get tap-by-tap
steps. Now the model emits track_date with the date it worked out from
"today"; the app saves it the way Add a date does, replies with what
really happened, and never puts the item on a shopping list.
"""
import json, os, tempfile, unittest
from datetime import timedelta


class _Client:
    def __init__(self, reply, actions):
        self.out = json.dumps({"reply": reply, "actions": actions})

    def chat(self, messages, **kw):
        return self.out, 0, 0


class TestAskTrackDate(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        state.set_current_user(None)
        self.state = state
        from api.deps import _d_today
        self.today = _d_today()

    def day(self, n):
        return (self.today + timedelta(days=n)).isoformat()

    def test_tracks_a_new_item_without_a_list(self):
        from api import chat_service, expiry
        applied, skipped = chat_service.apply_actions(
            [{"type": "track_date", "item": "milk", "date": self.day(1), "kind": "use_by"}])
        self.assertEqual(skipped, [])
        d = self.today + timedelta(days=1)
        self.assertEqual(applied, [f"Tracking milk until {d:%b} {d.day}. It will show under Use soon."])
        fl = self.state.flags()["manual-milk"]
        self.assertTrue(expiry.tracked(fl))
        self.assertEqual(fl["use_by"], self.day(1))
        self.assertEqual(fl["use_by_kind"], "use_by")
        self.assertFalse(fl.get("manual"))  # not a list row
        rows = [i for i in self.state.derived()["smart_list"]["items"] if i.get("on_list")]
        self.assertEqual(rows, [])

    def test_no_date_or_a_past_date_changes_nothing_and_says_so(self):
        from api import chat_service
        for date, word in ((None, "real date"), ("garbage", "real date"), (self.day(-2), "already passed")):
            applied, skipped = chat_service.apply_actions(
                [{"type": "track_date", "item": "milk", "date": date}])
            self.assertEqual(applied, [])
            self.assertIn(word, skipped[0])
        self.assertNotIn("manual-milk", self.state.flags())

    def test_reply_is_what_happened_when_nothing_was_tracked(self):
        from api import chat_service
        out = chat_service.chat(
            [{"role": "user", "content": "add this milk to my use soon list"}],
            _Client("Done, tracking milk.", [{"type": "track_date", "item": "milk"}]))
        self.assertEqual(out["applied"], [])
        self.assertIn("real date", out["reply"])
        self.assertNotIn("Done", out["reply"])

    def test_chat_applies_it_and_it_shows_under_use_soon(self):
        from api import chat_service
        out = chat_service.chat(
            [{"role": "user", "content": "milk expires tomorrow"}],
            _Client("", [{"type": "track_date", "item": "milk", "date": self.day(1)}]))
        self.assertEqual(len(out["applied"]), 1)
        snap = chat_service.snapshot()
        self.assertEqual([p["date"] for p in snap["pack_dates"]], [self.day(1)])


if __name__ == "__main__":
    unittest.main()
