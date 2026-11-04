"""Demo receipt date (owner, 2026-11-04): in the demo an earlier-dated
receipt still settles the trip, so judges can replay the playbook's
sample receipt on any day, and the session says so for the on-screen
notice. A real account is refused exactly as before."""
import os
import tempfile
import unittest


class TestDemoReceiptDate(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import quest, state
        self.q, self.state = quest, state
        self.sess = {"id": "s1", "started_at": "2026-11-06T10:00:00Z", "created_at": "2026-11-06T10:00:00Z"}
        self.old = {"receipt_id": "r1", "purchased_at": "2026-11-03"}

    def test_a_real_account_still_refuses_it(self):
        with self.assertRaisesRegex(ValueError, "before the hunt began"):
            self.q._check_receipt_is_this_trips(self.sess, self.old)

    def test_the_demo_accepts_it_and_says_when_it_was_from(self):
        tok = self.state._overlay.set({})
        try:
            self.assertEqual(self.q._check_receipt_is_this_trips(self.sess, self.old), "2026-11-03")
        finally:
            self.state._overlay.reset(tok)

    def test_a_same_day_receipt_needs_no_notice(self):
        tok = self.state._overlay.set({})
        try:
            ok = {"receipt_id": "r2", "purchased_at": "2026-11-06"}
            self.assertIsNone(self.q._check_receipt_is_this_trips(self.sess, ok))
        finally:
            self.state._overlay.reset(tok)


if __name__ == "__main__":
    unittest.main()
