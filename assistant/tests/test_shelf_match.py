"""Item–shelf matching: a hunt stop sits at the shelf its item
belongs to. Deterministic token overlap first ($0), one batched
Spark Standard call for the rest (stubbed here — tests never call
the live API), verdicts cached by item name. Sessions for stores
with no shelf graph are untouched, and matching never breaks
session creation."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class StubClient:
    """Stands in for MetaClient: canned matches, call counting,
    optional failure. Asserts the policy on every call — session
    lists are personal data, so Standard only."""

    def __init__(self, matches=None, fail=False):
        self.matches = matches or {}
        self.fail = fail
        self.calls = 0

    def chat(self, messages, mode="standard", personal=False, **k):
        self.calls += 1
        assert mode == "standard" and personal is True
        assert k.get("reasoning_effort") == "low"
        if self.fail:
            raise RuntimeError("model is down")
        return (json.dumps({"matches": self.matches}),
                {"input_tokens": 10, "cached_tokens": 0,
                 "output_tokens": 5}, 0.0001)


class StubMeta:
    """main.MetaClient stand-in: the routes build it with a ledger
    kwarg; chat forwards to the shared stub."""
    stub = None

    def __init__(self, *a, **k):
        pass

    def chat(self, *a, **k):
        return StubMeta.stub.chat(*a, **k)


class TestDeterministicMatch(unittest.TestCase):
    def setUp(self):
        from api import shelfmatch
        self.sm = shelfmatch
        self.graph = shelfmatch.graph_for("Trader Joe's")
        assert self.graph is not None

    def test_graph_keyed_by_store_name(self):
        assert self.sm.graph_for("trader-joes") is self.graph
        assert self.sm.graph_for("Costco Wholesale") is None

    def test_exact_label_overlap(self):
        assert self.sm.deterministic_match(
            "Pasta Sauce", self.graph) == "Pasta Sauce Shelf"

    def test_rare_token_match(self):
        # "milk" lives in exactly one label — strong on its own.
        assert self.sm.deterministic_match(
            "Organic Milk", self.graph) == "Milk & Dairy Shelf"
        assert self.sm.deterministic_match(
            "Whole Milk 1 gal", self.graph) == "Milk & Dairy Shelf"

    def test_common_token_alone_is_not_a_match(self):
        # "cheese" lives in three labels — the model pass decides.
        assert self.sm.deterministic_match("Cheese", self.graph) is None

    def test_no_overlap_no_match(self):
        assert self.sm.deterministic_match(
            "Unicorn Glitter", self.graph) is None

    def test_unidentified_is_never_a_destination(self):
        assert "Unidentified Shelf" not in self.sm.named_labels(self.graph)


class TestModelMatch(unittest.TestCase):
    def setUp(self):
        from api import shelfmatch
        self.sm = shelfmatch
        self.graph = shelfmatch.graph_for("Trader Joe's")

    def test_valid_label_kept(self):
        stub = StubClient({"Cheese": "Cheese Shelf"})
        out = self.sm.model_match(stub, ["Cheese"], self.graph)
        assert out == {"Cheese": "Cheese Shelf"}
        assert stub.calls == 1

    def test_invented_label_dropped(self):
        stub = StubClient({"Cheese": "Moon Shelf"})
        out = self.sm.model_match(stub, ["Cheese"], self.graph)
        assert out == {"Cheese": None}

    def test_omitted_item_is_no_match(self):
        stub = StubClient({})
        out = self.sm.model_match(stub, ["Cheese"], self.graph)
        assert out == {"Cheese": None}

    def test_failure_is_none_not_empty(self):
        # A failed call must not be cached as a verdict.
        stub = StubClient(fail=True)
        assert self.sm.model_match(stub, ["Cheese"], self.graph) is None

    def test_garbage_reply_is_none(self):
        class Prose:
            def chat(self, *a, **k):
                return ("no idea", {}, 0.0)
        assert self.sm.model_match(Prose(), ["Cheese"], self.graph) is None


class TestSessionMatching(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import quest
        self.quest = quest

    def test_ordering_fields_and_sources(self):
        stub = StubClient({"Cheese": "Cheese Shelf",
                           "Unicorn Glitter": None})
        sess = self.quest.create_session(
            "Trader Joe's", "quest",
            ["Frozen Pizza", "Unicorn Glitter", "Cheese"], client=stub)
        names = [it["name"] for it in sess["items"]]
        # Matched stops walk in shelf order; the unmatched stop
        # keeps its place after them.
        assert names == ["Cheese", "Frozen Pizza", "Unicorn Glitter"]
        cheese, pizza, uni = sess["items"]
        assert cheese["shelf_label"] == "Cheese Shelf"
        assert cheese["shelf_u"] == 0.0 and cheese["match_source"] == "model"
        assert pizza["shelf_label"] == "Frozen Pizza Shelf"
        assert pizza["shelf_u"] > 0.85 and pizza["match_source"] == "exact"
        assert uni["shelf_label"] is None and uni["shelf_u"] is None
        assert uni["match_source"] is None

    def test_cache_avoids_a_second_call(self):
        stub = StubClient({"Cheese": "Cheese Shelf"})
        self.quest.create_session("Trader Joe's", "quest", ["Cheese"],
                                  client=stub)
        assert stub.calls == 1
        sess = self.quest.create_session("Trader Joe's", "quest",
                                         ["Cheese"], client=stub)
        assert stub.calls == 1          # verdict came from the cache
        assert sess["items"][0]["shelf_label"] == "Cheese Shelf"
        assert sess["items"][0]["match_source"] == "model"

    def test_none_verdict_is_cached_too(self):
        stub = StubClient({"Unicorn Glitter": None})
        self.quest.create_session("Trader Joe's", "quest",
                                  ["Unicorn Glitter"], client=stub)
        self.quest.create_session("Trader Joe's", "quest",
                                  ["Unicorn Glitter"], client=stub)
        assert stub.calls == 1

    def test_model_failure_never_breaks_creation(self):
        stub = StubClient(fail=True)
        sess = self.quest.create_session("Trader Joe's", "quest",
                                         ["Cheese"], client=stub)
        assert sess["items"][0]["shelf_label"] is None
        # ...and the failure was not cached as a verdict: a working
        # client is asked again on the next session.
        good = StubClient({"Cheese": "Cheese Shelf"})
        sess = self.quest.create_session("Trader Joe's", "quest",
                                         ["Cheese"], client=good)
        assert good.calls == 1
        assert sess["items"][0]["shelf_label"] == "Cheese Shelf"

    def test_no_client_means_deterministic_only(self):
        sess = self.quest.create_session(
            "Trader Joe's", "quest", ["Pasta Sauce", "Cheese"])
        pasta, cheese = sess["items"]
        assert pasta["match_source"] == "exact"
        assert cheese["shelf_label"] is None

    def test_session_without_graph_unchanged(self):
        stub = StubClient({"Cheese": "Cheese Shelf"})
        sess = self.quest.create_session(
            "Costco Wholesale", "quest", ["Eggs", "Milk"], client=stub)
        assert [it["name"] for it in sess["items"]] == ["Eggs", "Milk"]
        assert all("shelf_label" not in it for it in sess["items"])
        assert stub.calls == 0

    def test_session_completes_with_unmatched_stops(self):
        sess = self.quest.create_session(
            "Trader Joe's", "quest", ["Unicorn Glitter", "Cheese"],
            client=StubClient({"Cheese": "Cheese Shelf"}))
        for it in list(sess["items"]):
            self.quest.check_item(sess["id"], it["name"], True)
        done = self.quest.get_session(sess["id"])
        assert self.quest.progress(done)["complete"] is True


class TestSessionMatchingApi(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        StubMeta.stub = StubClient({"Cheese": "Cheese Shelf"})
        from api import main
        main.MetaClient = StubMeta
        main._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={
            "username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_session_response_carries_shelf_fields(self):
        r = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": "cloud",
            "items": [{"name": "Organic Milk"}, {"name": "Cheese"}]})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # Cheese (u 0.0) walks before Milk & Dairy (u 0.94).
        assert [it["name"] for it in items] == ["Cheese", "Organic Milk"]
        assert items[0]["shelf_label"] == "Cheese Shelf"
        assert items[0]["match_source"] == "model"
        assert items[1]["shelf_label"] == "Milk & Dairy Shelf"
        assert items[1]["match_source"] == "exact"


class TestDemoUnchanged(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..",
                                     "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def test_demo_cannot_create_sessions(self):
        # The demo household stays read-only: session creation (and
        # with it, matching) is a normal write — 403, as before.
        r = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "Cheese"}]})
        assert r.status_code == 403


if __name__ == "__main__":
    unittest.main()
