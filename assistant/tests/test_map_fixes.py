"""Fixes from the codebase map (2026-10-29): account names cannot leave
their data folder, unreadable model answers are a 502 not a 500, an
undated receipt is refused out loud, flag writes do not drop each
other, and demo doors spend against the visit's own share."""
import json, os, tempfile, threading, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.setdefault("MODEL_API_KEY", "test-key")
from fastapi.testclient import TestClient  # noqa: E402


class TestAccountNames(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()

    def test_path_characters_refused(self):
        from api import auth
        for bad in ("../x", "a/b", "..", ".hidden", "a\\b", "a..b@x.co", "a b"):
            with self.assertRaises(ValueError, msg=bad):
                auth.create_user(bad, "long-password")

    def test_plain_names_and_emails_still_work(self):
        from api import auth
        for ok in ("bob", "tester-a@test.arya", "milk_runner@example.com",
                   "first.last+tag@mail.co"):
            self.assertEqual(auth.create_user(ok, "long-password"), ok)

    def test_federated_name_checked(self):
        from api import auth
        with self.assertRaises(ValueError):
            auth.ensure_federated_user("../evil@x.co")

    def test_data_dir_refuses_a_bad_current_user(self):
        from api import state
        tok = state._current_user.set("../escape")
        try:
            with self.assertRaises(ValueError):
                state.data_dir()
        finally:
            state._current_user.reset(tok)


class TestParseJson(unittest.TestCase):
    def test_wrapped_and_bad_answers(self):
        from api.meta_client import parse_json
        self.assertEqual(parse_json('{"a": 1}'), {"a": 1})
        self.assertEqual(parse_json('Sure! {"a": 1} hope that helps'), {"a": 1})
        for bad in ("no json here", "[1, 2]", ""):
            with self.assertRaises(RuntimeError):
                parse_json(bad)


class _Client:
    """MetaClient stand-in: answers every chat with self.answer."""
    answer = "not json"
    api_key = "test-key"

    def __init__(self, *a, ledger=None, **k):
        self.ledger = ledger

    def chat(self, messages, **k):
        if self.ledger is not None:
            self.ledger.record(mode="standard", model="m", input_tokens=1,
                               cached_tokens=0, output_tokens=1, cost_usd=0.01)
        return self.answer, {}, 0.01


class TestRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        from api import demo_guard
        self.main = main
        self._orig = deps.MetaClient
        deps.MetaClient = _Client
        _Client.answer = "not json"
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def tearDown(self):
        from api import deps
        deps.MetaClient = self._orig

    def test_unreadable_chat_answer_is_502(self):
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 502)

    def test_unreadable_order_text_is_502(self):
        r = self.c.post("/api/intake/order-text", json={"text": "x" * 40})
        self.assertEqual(r.status_code, 502)

    def test_undated_receipt_refused(self):
        _Client.answer = json.dumps({"store": "Costco", "lines": [
            {"product": "Eggs", "price": 5.0, "confidence": 0.9}], "subtotal": 5.0})
        r = self.c.post("/decode/photo", content=b"\xff\xd8fakejpeg",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 422)
        self.assertIn("date", r.json()["detail"])

    def test_parallel_flag_writes_keep_both_fields(self):
        from api import state
        tok = state._current_user.set("o@x.y")
        self.addCleanup(state._current_user.reset, tok)
        orig = state.flags
        gate = threading.Barrier(2)

        def slow_flags():
            out = orig()
            try:
                gate.wait(timeout=0.2)
            except threading.BrokenBarrierError:
                pass
            return out
        state.flags = slow_flags
        try:
            def write(k):
                state.set_current_user("o@x.y")  # threads start with a fresh context
                state.update_flag("eggs", lambda f: {**f, k: True})
            ts = [threading.Thread(target=write, args=(k,))
                  for k in ("never", "manual")]
            [t.start() for t in ts]
            [t.join() for t in ts]
        finally:
            state.flags = orig
        self.assertEqual(state.flags()["eggs"], {"never": True, "manual": True})


class TestDemoShare(unittest.TestCase):
    def test_photo_door_counts_against_the_visit(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        from api import deps
        from api import demo_guard
        orig = deps.MetaClient
        deps.MetaClient = _Client
        _Client.answer = "not json"
        try:
            c = TestClient(main.app)
            self.assertEqual(c.post("/auth/demo").status_code, 200)
            c.post("/decode/photo", content=b"\xff\xd8x", headers={"Content-Type": "image/jpeg"})
            box = demo_guard._demo_sandboxes[c.cookies.get("arya_session")]
            self.assertGreater(box.get(deps._DEMO_SPENT_KEY, 0), 0)
        finally:
            deps.MetaClient = orig
            state.set_overlay(None)


if __name__ == "__main__":
    unittest.main()
