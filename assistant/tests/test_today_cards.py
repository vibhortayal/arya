"""Customizable Today (owner, 2026-10-30): the cards shown and their
order are a per-account setting; absent means the default."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class TestTodayCards(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)

    def post(self, code=200, **body):
        r = self.c.post("/api/settings", json=body)
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    def test_default_is_none_and_not_asked(self):
        r = self.c.get("/api/settings").json()
        self.assertIsNone(r["today_cards"])
        self.assertFalse(r["today_asked"])

    def test_order_saved_and_deduped(self):
        r = self.post(today_cards=["price", "low", "price"])
        self.assertEqual(r["today_cards"], ["price", "low"])
        self.assertEqual(self.c.get("/api/settings").json()["today_cards"], ["price", "low"])

    def test_empty_list_hides_everything_and_null_resets(self):
        self.assertEqual(self.post(today_cards=[])["today_cards"], [])
        self.assertIsNone(self.post(today_cards=None)["today_cards"])

    def test_unknown_card_rejected(self):
        self.post(400, today_cards=["low", "nope"])
        self.post(400, today_cards="low")

    def test_asked_sticks(self):
        self.assertTrue(self.post(today_asked=True)["today_asked"])


class TestCardSizesAndDisplay(TestTodayCards):
    def test_sizes_merge_and_validate(self):
        self.assertEqual(self.c.get("/api/settings").json()["today_sizes"], {})
        self.post(today_sizes={"low": "s"})
        self.assertEqual(self.post(today_sizes={"lists": "l"})["today_sizes"], {"low": "s", "lists": "l"})
        self.post(400, today_sizes={"low": "xl"})
        self.post(400, today_sizes={"nope": "s"})

    def test_from_alexa_card_saves_like_the_others(self):
        # Hidden From Alexa card (2026-11-03): its id is a normal card id,
        # and today_sizes.alexa is the "already offered" mark.
        self.assertEqual(self.post(today_cards=["alexa", "trip"])["today_cards"], ["alexa", "trip"])
        self.assertEqual(self.post(today_sizes={"alexa": "m"})["today_sizes"], {"alexa": "m"})

    def test_display_defaults_merge_and_validate(self):
        d = self.c.get("/api/settings").json()["display"]
        self.assertEqual(d, {"text": 1, "spacing": "comfortable", "bold": False, "pictures": True, "motion": True})
        d = self.post(display={"text": 3, "bold": True})["display"]
        self.assertEqual((d["text"], d["bold"], d["spacing"]), (3, True, "comfortable"))
        self.post(400, display={"text": 9})
        self.post(400, display={"bold": 1})
        self.post(400, display={"font": "big"})


class TestLayouts(TestTodayCards):
    def test_layouts_per_screen(self):
        self.assertEqual(self.c.get("/api/settings").json()["layouts"], {})
        self.post(layouts={"lists": {"order": ["b", "a"], "hidden": ["c"]}})
        r = self.post(layouts={"ask": {"chips": ["What goes bad this week?"]}})
        self.assertEqual(r["layouts"]["lists"]["order"], ["b", "a"])
        self.assertEqual(r["layouts"]["ask"]["chips"], ["What goes bad this week?"])
        # a screen's value is replaced whole; null clears a key
        r = self.post(layouts={"ask": {"chips": None}})
        self.assertIsNone(r["layouts"]["ask"]["chips"])
        # Quest home panels (Edit Quest)
        r = self.post(layouts={"quest": {"order": ["trips", "cta"], "hidden": ["album"]}})
        self.assertEqual(r["layouts"]["quest"], {"order": ["trips", "cta"], "hidden": ["album"]})
        # The shopper's bottom bar (owner, 2026-11-01); the app cleans ids.
        r = self.post(layouts={"bar": {"on": ["list", "receipts", "stores-mine"]}})
        self.assertEqual(r["layouts"]["bar"], {"on": ["list", "receipts", "stores-mine"]})
        self.assertEqual(self.c.get("/api/settings").json()["layouts"]["bar"]["on"], ["list", "receipts", "stores-mine"])

    def test_layouts_validated(self):
        self.post(400, layouts={"nope": {"on": []}})
        self.post(400, layouts={"lists": {"order": "a"}})
        self.post(400, layouts={"ask": {"chips": ["x" * 121]}})
        self.post(400, layouts={"spending": {"on": [1]}})
        self.post(400, layouts={"bar": ["list"]})


class TestTodayHidden(TestTodayCards):
    """The ✕ on a Today row (owner, 2026-11-03): this account only, merged,
    null shows the row again, nothing else changes."""

    def test_hide_merge_and_undo(self):
        self.assertEqual(self.c.get("/api/settings").json()["today_hidden"], {})
        self.post(today_hidden={"r:Corner|Milk": "|2026-11-03"})
        got = self.post(today_hidden={"l:eggs": "[3,5]|2026-11-03"})["today_hidden"]
        self.assertEqual(got, {"r:Corner|Milk": "|2026-11-03", "l:eggs": "[3,5]|2026-11-03"})
        got = self.post(today_hidden={"r:Corner|Milk": None})["today_hidden"]
        self.assertEqual(got, {"l:eggs": "[3,5]|2026-11-03"})

    def test_hide_validates(self):
        self.post(400, today_hidden=["l:eggs"])
        self.post(400, today_hidden={"l:eggs": 3})
        self.post(400, today_hidden={"": "x|2026-11-03"})
        self.post(400, today_hidden={"k" * 161: "x|2026-11-03"})

    def test_hide_keeps_the_newest_past_the_cap(self):
        from api.routes import account
        for b in range(0, account.HIDDEN_MAX + 20, 50):
            self.post(today_hidden={f"l:{i}": f"s|2026-10-{1 + i % 28:02d}" for i in range(b, b + 50)})
        got = self.c.get("/api/settings").json()["today_hidden"]
        self.assertEqual(len(got), account.HIDDEN_MAX)
