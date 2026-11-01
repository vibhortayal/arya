"""List auto-suggest (owner, 2026-10-30): your names first, then the
shared dictionary (names with a household count, at least 3
households), then cached, filtered model guesses. Guesses are off for
the demo, with no key, and past the daily cap."""
import json, os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"

from api import state
from api.list import suggest


class FakeClient:
    def __init__(self, reply):
        self.reply, self.calls = reply, 0

    def chat(self, messages, **kw):
        self.calls += 1
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply, {}, 0.0


def put_household(user, names):
    d = state.user_dir(user)
    os.makedirs(d, exist_ok=True)
    flags = {"manual-" + str(i): {"manual": True, "name": n} for i, n in enumerate(names)}
    with open(os.path.join(d, "flags.json"), "w") as fh:
        json.dump(flags, fh)


class TestMatching(unittest.TestCase):
    def test_prefix_before_word_start(self):
        self.assertEqual(suggest.matches("Jasmine Rice", "jasm"), 0)
        self.assertEqual(suggest.matches("Basmati Rice", "ric"), 1)
        self.assertIsNone(suggest.matches("Milk", "jasm"))

    def test_only_the_last_item_is_completed(self):
        self.assertEqual(suggest.last_segment("eggs; ban"), "ban")
        self.assertEqual(suggest.last_segment("milk"), "milk")


class TestSharedDictionary(unittest.TestCase):
    def setUp(self):
        os.environ.pop("ARYA_SUGGEST_MIN_HOUSEHOLDS", None)
        root = os.path.join(state.base_dir(), "users")
        if os.path.isdir(root):
            for u in os.listdir(root):
                f = os.path.join(root, u, "flags.json")
                if os.path.exists(f):
                    os.remove(f)
        if os.path.exists(suggest._shared_path()):
            os.remove(suggest._shared_path())

    def test_needs_three_households_and_stores_only_counts(self):
        put_household("a1", ["Tamarind Paste", "Gift for Sam 5551234567"])
        put_household("a2", ["tamarind paste", "Za'atar"])
        put_household("a3", ["Tamarind Paste"])
        doc = suggest.rebuild_shared()
        self.assertEqual(doc["names"], {"Tamarind Paste": 3})
        raw = open(suggest._shared_path()).read()
        for who in ("a1", "a2", "a3"):
            self.assertNotIn(who, raw)

    def test_demo_household_is_never_counted(self):
        for u in ("demo", "b2", "b3"):
            put_household(u, ["Sumac"])
        self.assertEqual(suggest.rebuild_shared()["names"], {})

    def test_minimum_can_be_lowered(self):
        os.environ["ARYA_SUGGEST_MIN_HOUSEHOLDS"] = "1"
        put_household("c1", ["Sumac"])
        self.assertIn("Sumac", suggest.rebuild_shared()["names"])
        os.environ.pop("ARYA_SUGGEST_MIN_HOUSEHOLDS")

    def test_built_in_words_fill_in_until_there_are_users(self):
        names = [r["name"] for r in suggest.shared("mozz")]
        self.assertIn("Mozzarella", names)

    def test_non_grocery_names_never_enter(self):
        self.assertFalse(suggest.plausible("iPhone 15 case"))
        self.assertFalse(suggest.plausible("call me at 5551234567"))
        self.assertFalse(suggest.plausible("x"))
        self.assertTrue(suggest.plausible("Jasmine Rice"))


class TestGuesses(unittest.TestCase):
    def setUp(self):
        for p in (suggest._cache_path(), os.path.join(state.base_dir(), "suggest_guess.json")):
            if os.path.exists(p):
                os.remove(p)
        os.environ.pop("ARYA_SUGGEST_GUESS_CAP", None)

    def test_post_filter_drops_what_is_not_an_item(self):
        out = suggest.clean_guesses(
            ["Jasmine Rice", "Basmati Rice", "Here is a poem about rice", "iPhone case",
             "Jasmine Rice", "jasm", 7, "Rice; drop table"], "jasm")
        self.assertEqual(out, ["Jasmine Rice", "Basmati Rice"])

    def test_prefix_is_cached_and_second_ask_costs_nothing(self):
        c = FakeClient('{"names": ["Jasmine Rice", "Basmati Rice"]}')
        self.assertEqual(suggest.guess("jasm", c), ["Jasmine Rice", "Basmati Rice"])
        self.assertEqual(suggest.guess("JASM", c), ["Jasmine Rice", "Basmati Rice"])
        self.assertEqual(c.calls, 1)

    def test_short_prefix_never_calls_the_model(self):
        c = FakeClient('{"names": ["Milk"]}')
        self.assertEqual(suggest.guess("mil", c), [])
        self.assertEqual(c.calls, 0)

    def test_failed_or_garbled_call_is_no_guesses(self):
        self.assertEqual(suggest.guess("tamar", FakeClient(RuntimeError("down"))), [])
        self.assertEqual(suggest.guess("tamari", FakeClient("not json")), [])

    def test_daily_cap(self):
        os.environ["ARYA_SUGGEST_GUESS_CAP"] = "1"
        c = FakeClient('{"names": ["Ground Sumac"]}')
        self.assertEqual(suggest.guess("sumac", c), ["Ground Sumac"])
        self.assertEqual(suggest.guess("sumach", c), [])
        self.assertEqual(c.calls, 1)

    def test_switch_and_key(self):
        saved = {k: os.environ.get(k) for k in ("MODEL_API_KEY", "ARYA_SUGGEST_GUESSES")}

        def restore():
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restore)
        os.environ["MODEL_API_KEY"] = "k"
        os.environ["ARYA_SUGGEST_GUESSES"] = "0"
        self.assertFalse(suggest.guess_enabled())
        os.environ["ARYA_SUGGEST_GUESSES"] = "1"
        self.assertTrue(suggest.guess_enabled())
        os.environ.pop("MODEL_API_KEY")
        self.assertFalse(suggest.guess_enabled())


class TestRoutes(unittest.TestCase):
    def test_routes_exist_and_demo_gets_no_guesses(self):
        from api.routes import lists
        paths = {r.path for r in lists.router.routes}
        self.assertIn("/api/list/suggest", paths)
        self.assertIn("/api/list/suggest/guess", paths)
        src = open(lists.__file__).read()
        self.assertIn("_is_demo(req) or not suggest.guess_enabled()", src)

    def test_yours_comes_before_shared_and_no_repeats(self):
        d = {"smart_list": {"items": [{"name": "Jasmine Rice 10 lb"}]},
             "patterns": []}
        r = suggest.suggest("jasm", derived=d)
        self.assertEqual(r["rows"][0]["kind"], "yours")
        self.assertEqual(r["rows"][0]["tag"], "On this list")
        self.assertTrue(r["thin"])
        self.assertEqual(suggest.suggest("m", derived=d)["rows"], [])


if __name__ == "__main__":
    unittest.main()


class TestGroceryLexicon(unittest.TestCase):
    """Intelligence review 2026-11-01 (3.7): a built-in word list in
    tier 2 replaces live model guesses while typing."""

    def test_the_word_list_loads_and_is_plain(self):
        words = suggest.lexicon()
        self.assertGreater(len(words), 400)
        self.assertEqual(len({suggest.key(w) for w in words}), len(words))
        self.assertFalse([w for w in words if w.startswith("#") or len(w) > 40])

    def test_typing_finds_it_with_no_model(self):
        names = [r["name"] for r in suggest.shared("rasp")]
        self.assertIn("Raspberries", names)
        self.assertIn("Dishwasher Pods", [r["name"] for r in suggest.shared("dishw")])

    def test_live_guesses_are_off_by_default(self):
        saved = {k: os.environ.get(k) for k in ("MODEL_API_KEY", "ARYA_SUGGEST_GUESSES")}

        def restore():
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restore)
        os.environ["MODEL_API_KEY"] = "k"
        os.environ.pop("ARYA_SUGGEST_GUESSES", None)
        self.assertFalse(suggest.guess_enabled())
