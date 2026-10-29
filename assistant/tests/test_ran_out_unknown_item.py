"""'I ran out of tahini' for an item with no receipts yet — audit 2026-10-29.

Ask used to answer "I don't track tahini yet" and add nothing, so the
shopper's own words were lost. A ran-out report on an unknown name now
puts it on the list, the same as an add.
"""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()


class TestRanOutUnknown(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        state.set_current_user(None)
        self.state = state

    def test_unknown_name_joins_the_list(self):
        from api import chat_service
        applied, skipped = chat_service.apply_actions(
            [{"type": "ran_out", "item": "tahini"}])
        self.assertEqual(applied, ["Added tahini to your list."])
        self.assertEqual(skipped, [])
        fl = self.state.flags()["manual-tahini"]
        self.assertTrue(fl["manual"])
        self.assertEqual(fl["name"], "tahini")

    def test_other_actions_on_unknown_names_still_skip(self):
        from api import chat_service
        applied, skipped = chat_service.apply_actions(
            [{"type": "snooze", "item": "tahini"}])
        self.assertEqual(applied, [])
        self.assertEqual(len(skipped), 1)
        self.assertNotIn("manual-tahini", self.state.flags())
