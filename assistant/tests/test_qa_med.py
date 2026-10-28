"""QA pass 2026-10-28, Med findings."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name)) as f:
        return f.read()


class TestFrontEnd(unittest.TestCase):
    def test_staples_count_skips_checked_and_typed(self):
        js = read("app.js")
        body = js.split("function staplesLine(")[1].split("\n}")[0]
        self.assertIn('!i.checked && i.source !== "user"', body)

    def test_tabs_open_at_the_top(self):
        js = read("app.js")
        body = js.split("function show(id)")[1].split("\n}")[0]
        self.assertIn("window.scrollTo(0, 0)", body)

    def test_ask_bubbles_clear_the_composer(self):
        self.assertIn("#chat-log > .bubble { scroll-margin-bottom",
                      read("styles.css"))


class TestBadges(unittest.TestCase):
    def test_progress_never_overflows_its_target(self):
        from api import social
        ctx = {"receipts": [0] * 40, "egg_receipts": 9,
               "banana_weeks": set(range(26)), "done": [], "reports": []}
        details = {b["id"]: b["check"](ctx)[1] for b in social.BADGES}
        self.assertEqual(details["top_contributor"], "10 of 10 receipts")
        self.assertEqual(details["egg_baron"], "5 of 5 egg receipts")
        self.assertEqual(details["banana_republic"], "4 of 4 banana weeks")


class TestDaysAgo(unittest.TestCase):
    def test_today_ref_is_never_before_the_last_receipt(self):
        from api import state
        from datetime import date
        old = state.as_of
        try:
            state.as_of = lambda: "2020-01-01"
            self.assertEqual(state.today_ref(), date.today().isoformat())
            state.as_of = lambda: "2999-01-01"
            self.assertEqual(state.today_ref(), "2999-01-01")
        finally:
            state.as_of = old


class TestOptimizerSummary(unittest.TestCase):
    def test_merged_name_is_not_also_corrected(self):
        src = open(os.path.join(os.path.dirname(__file__), "..", "api",
                                "optimizer.py")).read()
        self.assertIn("merged_names", src)
