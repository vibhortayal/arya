"""Add is one surface for the list (owner clarification
2026-10-27): one text field (typing and paste are the same act),
a mic, and a smart camera. A list photo adds items; a receipt
photo adds nothing and is offered filing instead — receipts enter
by image only, and the Add tab no longer decodes them. The server
split of pasted text is deterministic; a Spark call runs only
when the split finds nothing sensible."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from tests import frontend  # noqa: E402

HERE = os.path.dirname(__file__)


class StubClient:
    """chat branches on the call: an image read answers with the
    canned photo reply; a text extraction answers with canned
    items. Counts calls so tests can prove the split stayed $0."""

    photo_reply = {"kind": "list", "items": ["oat milk", "eggs"]}
    extract_items = ["milk", "eggs"]

    def __init__(self, ledger=None):
        pass

    calls = 0

    def chat(self, messages, mode=None, personal=None, **k):
        assert personal is True and mode == "standard"
        StubClient.calls += 1
        user = messages[-1]["content"]
        if isinstance(user, list):
            return json.dumps(StubClient.photo_reply), {}, 0.01
        return json.dumps({"items": StubClient.extract_items}), {}, 0.01


def fresh_client(case):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    StubClient.calls = 0
    StubClient.photo_reply = {"kind": "list", "items": ["oat milk", "eggs"]}
    from api import main
    from api import deps
    deps.MetaClient = StubClient
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    r = case.c.post("/auth/setup", json={"username": "t@x.y",
                                         "password": "long-password"})
    assert r.status_code == 200, r.text
    return case.c


def list_names(c):
    home = c.get("/api/home").json()
    return [i["name"] for i in home["list"]["items"]]


class TestShellContract(unittest.TestCase):
    def test_single_surface_no_doors(self):
        lists = frontend.src("screens/Lists.tsx")
        assert 'id="add-text"' in lists
        assert 'className={"addline' in lists  # one row, like the Ask input
        assert 'id="add-mic"' in lists and 'id="add-photo"' in lists
        # The owner dropped the "add from Muse chat" footer (2026-10-29).
        app = frontend.app()
        assert "You can also add from Muse chat" not in app
        assert 'id="doors"' not in app
        assert "doorCard" not in app and '"door-' not in app
        assert "/api/list/from-text" in lists
        assert "/api/list/from-photo" in lists

    def test_no_order_intake_copy_anywhere(self):
        src = frontend.app()
        assert "Order confirmation" not in src
        assert "File this order" not in src
        assert "An online order, pasted as text" not in src

    def test_receipts_view_has_its_own_photo_action(self):
        view = frontend.src("screens/Receipts.tsx")
        assert "Add a receipt photo" in view
        assert 'id="rc-photo"' in view


class TestSplitListText(unittest.TestCase):
    def setUp(self):
        from api.list.intake import split_list_text
        self.split = split_list_text

    def test_whatsapp_style(self):
        text = ("Grocery list:\n- Milk x2\n- Eggs\n"
                "Bread, butter\n2. Sourdough loaf")
        assert self.split(text) == ["Milk", "Eggs", "Bread", "butter",
                                    "Sourdough loaf"]

    def test_bullets_numbers_checkboxes(self):
        text = "• oat milk\n1) eggs\n[ ] spinach\n* rice"
        assert self.split(text) == ["oat milk", "eggs", "spinach", "rice"]

    def test_lead_ins_and_dupes(self):
        assert self.split("add milk, buy eggs, milk") == ["milk", "eggs"]

    def test_chatter_yields_nothing(self):
        text = ("Hey! Can you grab the stuff we talked about "
                "yesterday? Thanks so much!!")
        assert self.split(text) == []


class TestFromText(unittest.TestCase):
    def setUp(self):
        self.c = fresh_client(self)

    def test_whatsapp_message_adds_without_a_model_call(self):
        r = self.c.post("/api/list/from-text", json={
            "text": "Grocery list:\n- Milk x2\n- Eggs\nBread, butter"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "split" and body["added"] == 4
        assert StubClient.calls == 0
        names = list_names(self.c)
        for n in ("Milk", "Eggs", "Bread", "butter"):
            assert n in names, names

    def test_one_too_long_item_says_it_was_left_out(self):
        # Pilot 2026-10-29: a ~190-character item added 0 with no reason.
        StubClient.extract_items = []
        try:
            r = self.c.post("/api/list/from-text", json={"text": "organic " * 24})
        finally:
            StubClient.extract_items = ["milk", "eggs"]
        body = r.json()
        assert r.status_code == 200 and body["added"] == 0, body
        assert body["skipped"], body

    def test_chatter_falls_back_to_one_model_call(self):
        r = self.c.post("/api/list/from-text", json={
            "text": "Hey! Can you grab the stuff we talked about "
                    "yesterday? Thanks so much!!"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "model" and body["added"] == 2
        assert StubClient.calls == 1
        names = list_names(self.c)
        assert "milk" in names and "eggs" in names

    def test_empty_text_is_400(self):
        r = self.c.post("/api/list/from-text", json={"text": "  "})
        assert r.status_code == 400


class TestFromPhoto(unittest.TestCase):
    def setUp(self):
        self.c = fresh_client(self)

    def _photo(self):
        return self.c.post("/api/list/from-photo",
                           content=b"\xff\xd8\xff fake",
                           headers={"Content-Type": "image/jpeg"})

    def test_list_photo_adds_items(self):
        r = self._photo()
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "list" and body["added"] == 2
        assert body["names"] == ["oat milk", "eggs"]
        names = list_names(self.c)
        assert "oat milk" in names and "eggs" in names

    def test_receipt_photo_adds_nothing(self):
        StubClient.photo_reply = {"kind": "receipt", "items": []}
        before = list_names(self.c)
        r = self._photo()
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "receipt" and body["added"] == 0
        # no list adds, and nothing filed either — filing is the
        # separate /decode/photo step the client offers next
        assert list_names(self.c) == before
        assert self.c.get("/api/quest/receipts").json()["receipts"] == []

    def test_single_item_photo_is_offered_not_added(self):
        StubClient.photo_reply = {"kind": "item", "item": "peach", "confident": True}
        before = list_names(self.c)
        body = self._photo().json()
        assert body["kind"] == "item" and body["item"] == "peach"
        assert body["confident"] is True and body["added"] == 0
        assert list_names(self.c) == before

    def test_empty_list_photo_is_unclear_with_a_reason(self):
        StubClient.photo_reply = {"kind": "list", "items": []}
        body = self._photo().json()
        assert body["kind"] == "unclear" and body["added"] == 0
        assert body["reason"]

    def test_rejects_non_image(self):
        r = self.c.post("/api/list/from-photo", content=b"x",
                        headers={"Content-Type": "text/plain"})
        assert r.status_code == 415


if __name__ == "__main__":
    unittest.main()
