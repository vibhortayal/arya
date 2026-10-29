"""Hunt v2 screen pins (rebuild plan items 5-8, 2026-10-28): a
finished hunt is closed — the Quest hero clears, the hunt shows once
under Finished, Profile counts finished and receipt-attached hunts
apart, and nothing on Finish, Score or the Add receipt sheet claims
the receipt was verified. Back is a stack, and the resume route
opens a finished hunt on its Score.

Pins over the React screens (web/src). The Back stack runs under
vitest in web/src/screens/hunt/hunt.test.tsx and web/src/app/nav.test.tsx.
"""
import unittest

from tests.frontend import src


class TestHuntV2Screens(unittest.TestCase):
    def test_labels_are_one_vocabulary(self):
        js = src("screens/Quest.tsx")
        table = js.split("QSTATE_KEY: Record<string, string> = {")[1].split("}")[0]
        self.assertIn('"No receipt yet"', table)
        self.assertIn('"Finished · Receipt added"', table)
        # Profile's missing-receipt rows use the same words.
        self.assertIn("in cart · No receipt yet", src("screens/Profile.tsx"))

    def test_today_hero_clears_on_finish(self):
        js = src("screens/Quest.tsx")
        pick = js.split("function heroSession(")[1].split("\n}")[0]
        # Only an open hunt holds the hero; a finished one never does.
        for state in ('"playing"', '"paused"', '"not_started"'):
            self.assertIn(state, pick)
        self.assertNotIn('"finished"', pick)
        self.assertNotIn('"done"', pick)
        hero = js.split("const heroCard = () => {")[1].split("\n  };")[0]
        # New-user pass (2026-10-29): no empty box.
        self.assertIn("if (!hero) return null;", hero)
        self.assertNotIn("No quest in progress", js)
        self.assertIn('<p className="g-group">Finished</p>', js)

    def test_profile_counts_finished_and_attached_apart(self):
        prog = src("screens/QuestProgress.tsx")
        self.assertIn(">Quests finished<", prog)
        self.assertIn(">Receipt added<", prog)
        self.assertIn('id="pf-missing"', src("screens/Profile.tsx"))

    def test_add_receipt_is_reachable_everywhere(self):
        self.assertIn("export function AddReceiptSheet(", src("ui/AddReceiptSheet.tsx"))
        score = src("screens/Score.tsx")
        self.assertIn('id="score-addreceipt"', score)
        for rel in ("screens/Score.tsx", "screens/Receipts.tsx", "screens/Profile.tsx", "screens/haul/Reveal.tsx"):
            self.assertIn("<AddReceiptSheet ", src(rel), rel)
        # Profile's missing-receipt row opens it.
        self.assertIn("onClick={() => setAr({ sessionId: e.session_id, label: e.store })}>Add receipt", src("screens/Profile.tsx"))

    def test_copy_never_claims_verified(self):
        for rel in ("screens/Finish.tsx", "ui/AddReceiptSheet.tsx", "screens/Score.tsx"):
            self.assertNotIn("erified", src(rel), rel)

    def test_demo_doors_only_in_the_demo(self):
        for rel, el in (("screens/Finish.tsx", "fin-sample"), ("ui/AddReceiptSheet.tsx", "ar-sample")):
            js = src(rel)
            tag = js.split(f'id="{el}"')[0].rsplit("<p", 1)[1]
            self.assertIn("demo-only", tag, el)
            self.assertIn("hidden={!demo}", tag, el)
            self.assertIn("/sample-receipt", js, rel)

    def test_back_is_a_stack(self):
        fin = src("screens/Finish.tsx")
        self.assertIn('nav.back(); }}><span aria-hidden="true">‹ </span>Back to the quest</a>', fin)
        self.assertIn("Back is a stack", src("screens/hunt/hunt.test.tsx"))

    def test_resume_opens_a_finished_hunt_on_score(self):
        body = src("screens/Hunt.tsx").split("const openSession = (s0: Session) => {")[1].split("\n  };")[0]
        self.assertIn('nav.show("score", { session: s0 })', body)
        self.assertIn('"finished"', body)
        self.assertIn('"done"', body)


if __name__ == "__main__":
    unittest.main()
