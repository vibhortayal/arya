"""Ask says what really happened to an add (owner bug, 2026-11-03).

"We finished the yogurt" with "yogurts x2" on Costcozy: Arya replied it
would add yogurt, but the add asked "which list?" (a typed row's list
was not looked up) and the model's own "I'll add it" stood. Now the
row's list counts, a row already there says so, and when nothing was
added the reply is what happened.
"""
import json, os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()


class _Client:
    def __init__(self, reply, actions):
        self.out = json.dumps({"reply": reply, "actions": actions})

    def chat(self, messages, **kw):
        return self.out, 0, 0


class TestAskAddHonest(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        state.set_current_user(None)
        state.save_named_lists([{"id": "l-c", "name": "Costcozy", "stores": []},
                                {"id": "l-t", "name": "TJ", "stores": []}])
        self.state = state

    def rows(self):
        return {i["item_id"]: i.get("list") for i in self.state.derived()["smart_list"]["items"]
                if i.get("on_list") and not i.get("checked")}

    def voice_add(self):
        from api.routes.lists import _add_name_to_list
        return _add_name_to_list("yogurts", qty=2, list_id="l-c")["item_id"]

    def test_already_on_its_list_says_so(self):
        from api import chat_service
        iid = self.voice_add()
        for typ in ("ran_out", "add_to_list"):
            applied, skipped = chat_service.apply_actions([{"type": typ, "item": "yogurt"}])
            self.assertEqual(applied, [])
            self.assertEqual(skipped, ["Yogurts is already on Costcozy."])
        self.assertEqual(self.rows(), {iid: "l-c"})
        self.assertEqual(self.state.flags()[iid]["qty_override"], 2)

    def test_removed_row_comes_back_on_its_list(self):
        from api import chat_service
        from api.routes.lists import _remove_item
        iid = self.voice_add()
        _remove_item(iid, "l-c")
        self.assertEqual(self.rows(), {})
        applied, skipped = chat_service.apply_actions([{"type": "ran_out", "item": "yogurt"}])
        self.assertEqual(applied, ["Added yogurt to Costcozy."])
        self.assertEqual(skipped, [])
        self.assertEqual(self.rows(), {iid: "l-c"})

    def test_new_quantity_still_updates(self):
        from api import chat_service
        iid = self.voice_add()
        applied, _ = chat_service.apply_actions([{"type": "add_to_list", "item": "yogurt", "qty": 3}])
        self.assertEqual(applied, ["Added yogurt ×3 to Costcozy."])
        self.assertEqual(self.state.flags()[iid]["qty_override"], 3)

    def test_reply_does_not_claim_an_add_that_did_not_happen(self):
        from api import chat_service
        out = chat_service.chat([{"role": "user", "content": "we finished the yogurt"}],
                                _Client("I'll add yogurt to your list.", [{"type": "ran_out", "item": "yogurt"}]))
        self.assertEqual(out["applied"], [])
        self.assertEqual(out["reply"], "Which list should yogurt go on: Costcozy, TJ?")
        self.assertEqual(out["skipped"], [])
        self.assertEqual([c["label"] for c in out["choices"]], ["Costcozy", "TJ"])
        self.assertEqual(self.rows(), {})
        # Already there: the reply says so.
        self.voice_add()
        out = chat_service.chat([{"role": "user", "content": "we finished the yogurt"}],
                                _Client("I'll add yogurt to your list.", [{"type": "ran_out", "item": "yogurt"}]))
        self.assertEqual(out["reply"], "Yogurts is already on Costcozy.")

    def test_a_real_add_keeps_the_model_reply(self):
        from api import chat_service
        self.voice_add()
        out = chat_service.chat([{"role": "user", "content": "add milk to TJ"}],
                                _Client("Added milk to TJ.", [{"type": "add_to_list", "item": "milk", "list": "TJ"}]))
        self.assertEqual(out["applied"], ["Added milk to TJ."])
        self.assertEqual(out["reply"], "Added milk to TJ.")


if __name__ == "__main__":
    unittest.main()
