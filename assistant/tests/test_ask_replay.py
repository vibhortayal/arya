"""Ask fixes from the Tester's live run 2 (2026-11-01, ask-run-live2.json):
an actions-only turn no longer drops out of the history (the model then
re-applied the earlier add), prompt labels never reach the reply, and the
prompt carries the friends, budget and last-message-only rules."""
import os, unittest

from tests.test_ask_gaps import AskCase
from api import chat_service


class Turns(unittest.TestCase):
    def test_empty_assistant_turn_is_kept_and_marked_done(self):
        h = [{"role": "user", "content": "Add oat milk to my Costco list"},
             {"role": "assistant", "content": "", "applied": ["Added oat milk to Costcozy."]},
             {"role": "user", "content": "Remove rice from the Costco list"}]
        t = chat_service._turns(h)
        self.assertEqual([m["role"] for m in t], ["user", "assistant", "user"])
        self.assertEqual(t[1]["content"], "(done: Added oat milk to Costcozy.)")

    def test_old_client_without_applied_still_alternates(self):
        h = [{"role": "user", "content": "add milk"}, {"role": "assistant", "content": ""},
             {"role": "user", "content": "remove rice"}]
        self.assertEqual(chat_service._turns(h)[1], {"role": "assistant", "content": "(done)"})

    def test_reply_and_applied_both_kept(self):
        t = chat_service._turns([{"role": "assistant", "content": "Sure.", "applied": ["Added eggs."]}])
        self.assertEqual(t[0]["content"], "Sure.\n(done: Added eggs.)")

    def test_empty_user_turns_and_other_roles_dropped(self):
        t = chat_service._turns([{"role": "system", "content": "x"}, {"role": "user", "content": " "},
                                 {"role": "user", "content": "hi"}])
        self.assertEqual(t, [{"role": "user", "content": "hi"}])


class Labels(unittest.TestCase):
    def test_labels_replaced(self):
        s = chat_service._scrub_labels
        self.assertEqual(s("For full offline use, ABOUT ARYA doesn't say more."),
                         "For full offline use, Arya's guide doesn't say more.")
        self.assertEqual(s("The HOUSEHOLD SNAPSHOT shows 39 receipts."), "Your data shows 39 receipts.")
        self.assertEqual(s("Nothing to scrub."), "Nothing to scrub.")
        self.assertEqual(s(""), "")


class Prompt(unittest.TestCase):
    def test_rules_present(self):
        p = open(chat_service.PROMPT_PATH).read()
        self.assertIn("Actions are only for the LAST user message", p)
        self.assertIn("never answer with this household's own receipts", p)
        self.assertIn("never say they \"can't be\" over budget", p)
        self.assertIn("never name them in the reply", p)


class Replay(AskCase):
    def test_model_sees_done_turn_between_two_asks(self):
        self.answer = {"reply": "", "actions": []}
        r = self.c.post("/api/chat", json={"messages": [
            {"role": "user", "content": "Add oat milk to my Costco list"},
            {"role": "assistant", "content": "", "applied": ["Added oat milk to Costcozy."]},
            {"role": "user", "content": "Remove rice from the Costco list"}]})
        self.assertEqual(r.status_code, 200, r.text)
        convo = [m for m in self.seen[-1] if m["role"] in ("user", "assistant")][-3:]
        self.assertEqual([m["role"] for m in convo], ["user", "assistant", "user"])
        self.assertIn("(done: Added oat milk", convo[1]["content"])

    def test_reply_label_scrubbed_end_to_end(self):
        self.answer = {"reply": "ABOUT ARYA doesn't say more.", "actions": []}
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "Does Arya work offline?"}]})
        self.assertEqual(r.json()["reply"], "Arya's guide doesn't say more.")


if __name__ == "__main__":
    unittest.main()
