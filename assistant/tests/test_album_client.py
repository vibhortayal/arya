"""Game: album, client. String pins over album.js / album.css /
index.html / quest.js, plus a node harness (skipped without node) that
runs album.js ALONE against a tiny fake DOM: pure helpers, the New
sticker card lifecycle with fake timers, the level-up card, and the
Album screen render."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
NODE = shutil.which("node")

BANNED = r"\b(lives|game over|timer|streak|hurry|penalty|retake|try again|incomplete|last place|failed|verified|cropped|frame deleted)\b"


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


def strip_js_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", src)


HAUL_GUARD = "if (window.AlbumUI && profile) AlbumUI.maybeLevelUp(profile);"


class TestAlbumPins(unittest.TestCase):
    def test_script_and_link_order(self):
        html = read("index.html")
        self.assertIn('<script src="album.js"></script>', html)
        self.assertLess(html.index('<script src="quest.js"></script>'),
                        html.index('<script src="album.js"></script>'))
        self.assertLess(html.index('<script src="album.js"></script>'),
                        html.index('<script src="mapper.js"></script>'))
        self.assertLess(html.index('href="styles.css"'), html.index('href="album.css"'))

    def test_nav_row_in_the_crew_group(self):
        html = read("index.html")
        crew = html.split('id="view-community"')[1].split('id="view-race"')[0]
        self.assertIn('data-qnav="view-album"', crew)
        self.assertIn('id="album-nav-sub"', crew)
        self.assertIn("navrow", crew.split('data-qnav="view-album"')[0].rsplit("<button", 1)[1])

    def test_the_album_screen_ships_in_index_html(self):
        # The nav row is static, so its screen is static too. Without
        # album.js the row must not open a blank screen.
        html = read("index.html")
        self.assertEqual(html.count('id="view-album"'), 1)
        self.assertIn('<section id="view-album" class="view" hidden>', html)
        sec = html.split('<section id="view-album"')[1].split("</section>")[0]
        for needle in ('id="alb-sub"', 'id="alb-body"', "qback"):
            self.assertIn(needle, sec, needle)
        # album.js still builds it when it is missing (older shell).
        js = read("album.js")
        self.assertIn('if (!document.getElementById("view-album"))', js)
        self.assertIn('id="view-album"', js)

    def test_questgo_only_opens_the_album_when_it_can_render(self):
        js = read("quest.js")
        body = js.split("function questGo(id) {")[1].split("\n}")[0]
        self.assertIn('if (id === "view-album") {', body)
        guard = 'if (!window.renderAlbum || !document.getElementById(id)) return;'
        self.assertIn(guard, body)
        self.assertLess(body.index(guard), body.index("renderAlbum().catch(showErr);"))
        self.assertLess(body.index(guard), body.index("questShow(id);"))

    def test_crew_paints_the_nav_count_from_the_profile_it_already_loaded(self):
        quest = read("quest.js")
        call = "if (profile && profile.album && window.albumPaintNav) albumPaintNav(profile.album.stickers);"
        self.assertEqual(quest.count(call), 1)
        crew = quest.split("async function renderCommunity() {")[1].split("\n}")[0]
        self.assertIn(call, crew)
        self.assertEqual(crew.count('api("/api/quest/profile")'), 1)
        album = strip_js_comments(read("album.js"))
        self.assertNotIn("/api/quest/profile", album)       # no second fetch
        self.assertNotIn("renderCommunity", album)
        self.assertIn("window.albumPaintNav = albumPaintNav;", album)
        # quest.js reaches the album only behind guards.
        self.assertNotIn("AlbumUI", quest.replace(HAUL_GUARD, ""))

    def test_badge_art_has_receipt_keeper(self):
        self.assertIn('receipt_keeper: "pantry.webp"', read("app.js"))

    def test_local_storage_is_always_in_try(self):
        js = read("album.js")
        hits = [m.start() for m in re.finditer(r"localStorage\.", js)]
        self.assertTrue(hits)
        for i in hits:
            self.assertIn("try {", js[max(0, i - 120):i])
        self.assertIn("arya-album-level", js)
        self.assertNotIn("arya-hunt-ui", js)
        for cancelled in ("arya-carry", "arya-pack-queue", "arya-queued"):
            self.assertNotIn(cancelled, js)

    def test_contract_names_exist(self):
        js = read("album.js")
        for name in ("albumSlots", "albumProgressText", "albumStickerSrc", "albumNewSetFrom",
                     "albumLevelHtml", "albumNewFor", "albumHaul", "renderAlbum"):
            self.assertIn(f"function {name}(", js)
        self.assertIn("window.AlbumUI = {", js)
        for member in ("onNewSticker", "cardOpen", "maybeLevelUp"):
            self.assertRegex(js, rf"{member}:")
        self.assertIn('"arya:grabbed"', js)
        self.assertIn("delete sess.new_sticker", js)
        self.assertIn("putBackStop", js)
        self.assertIn("ALB_CARD_MS = 2600", js)

    def test_quest_js_is_not_made_to_depend_on_the_album(self):
        # quest.js loads alone in many harnesses: it only ever reaches
        # the album behind a guard.
        # The one allowed mention is the guarded level-up call (C10).
        self.assertNotIn("AlbumUI", read("quest.js").replace(HAUL_GUARD, ""))

    def test_copy(self):
        js = strip_js_comments(read("album.js"))
        for s in ("New sticker", "Other finds", "No rush", "Seasonal",
                  "Only the product is kept in your album. No people."):
            self.assertIn(s, js, s)
        self.assertNotIn("Frame deleted", js)
        self.assertNotRegex(js, r"(?i)frame deleted")
        # No emoji anywhere in the file.
        self.assertIsNone(re.search("[\U0001F300-\U0001FAFF☀-➿]", js))

    def test_no_chat_no_trade_no_comment_surface(self):
        js = strip_js_comments(read("album.js")).lower()
        for bad in ("textarea", "<input", "comment", "trade", "chat", "price"):
            self.assertNotIn(bad, js, bad)


class TestAlbumCss(unittest.TestCase):
    css = read("album.css")

    def rule(self, selector):
        m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", self.css)
        self.assertIsNotNone(m, selector)
        return m.group(1)

    def test_slots(self):
        self.assertIn("dashed", self.rule(".albslot.empty"))
        self.assertIn("aspect-ratio: 1", self.rule(".albslot"))
        self.assertIn("border-radius: 50%", self.rule(".albslot"))
        self.assertIn("repeat(4, 1fr)", self.rule(".albgrid"))
        self.assertIn("66%", self.rule(".albslot img"))
        self.assertIn("8px", self.rule(".albprog"))

    def test_44px_targets(self):
        for sel in (".albtab", ".albslot", ".stkcard .undo", ".ladderrow", ".albhead"):
            self.assertIn("min-height: 44px", self.rule(sel), sel)

    def test_card_sits_above_the_toast_line(self):
        card = self.rule(".stkcard")
        self.assertIn("position: fixed", card)
        self.assertIn("bottom: calc(80px + env(safe-area-inset-bottom))", card)
        self.assertIn("prefers-reduced-motion", self.css)
        self.assertRegex(self.css.split("prefers-reduced-motion")[1], r"\.stkcard\s*\{\s*animation:\s*none")

    def test_tokens_only_and_no_gradient_no_lock(self):
        css = re.sub(r"/\*.*?\*/", "", self.css, flags=re.S)
        self.assertIsNone(re.search(r"#[0-9a-fA-F]{3,8}\b", css))
        self.assertNotIn("gradient", css)
        self.assertNotRegex(css.lower(), r"padlock|lock-icon|\.lock\b|\\1f512")
        for tok in re.findall(r"var\((--[a-z0-9-]+)\)", self.css):
            self.assertIn(tok, read("styles.css"), tok)

    def test_text_is_15px_or_more_except_chips(self):
        for m in re.finditer(r"([^{}]+)\{([^}]*)\}", self.css):
            for size in re.findall(r"font-size:\s*([\d.]+)(px|rem)", m.group(2)):
                px = float(size[0]) * (16 if size[1] == "rem" else 1)
                if px < 15:
                    self.assertIn("chip", m.group(1), m.group(1))
                    self.assertEqual(px, 12.0)

    def test_prefix_discipline(self):
        for sel in re.findall(r"(?m)^([.#][\w-]+)", self.css):
            name = sel[1:]
            self.assertRegex(name, r"^(alb|stk|level|ladder|view-album)", sel)

    def test_styles_css_untouched(self):
        css = read("styles.css")
        for cls in (".albslot", ".stkcard", ".levelcard", ".ladderrow"):
            self.assertNotIn(cls, css)


PRELUDE = r"""
const __timers = []; let __tid = 0;
globalThis.setTimeout = (fn, ms) => { __timers.push({ id: ++__tid, fn, ms, live: true }); return __tid; };
globalThis.clearTimeout = id => { const t = __timers.find(x => x.id === id); if (t) t.live = false; };
const __els = {};
function __mk(id) {
  return __els[id] = { id, hidden: true, innerHTML: "", textContent: "", dataset: {}, listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } };
}
["album-nav-sub"].forEach(__mk);
const __host = { insertAdjacentHTML(_w, html) { for (const m of html.matchAll(/ id="([^"]+)"/g)) __mk(m[1]); } };
globalThis.document = {
  listeners: {}, body: __host,
  getElementById(id) { return __els[id] || null; },
  querySelector(sel) { if (sel === "main") return __host; return sel[0] === "#" ? (__els[sel.slice(1)] || null) : null; },
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
};
globalThis.window = globalThis;
globalThis.$ = s => document.querySelector(s);
const __store = {};
globalThis.localStorage = { getItem(k) { return k in __store ? __store[k] : null; }, setItem(k, v) { __store[k] = String(v); }, removeItem(k) { delete __store[k]; } };
globalThis.Q = { current: null };
globalThis.__put = [];
globalThis.putBackStop = i => { __put.push(i); };
globalThis.__api = {};
globalThis.api = async path => {
  const v = __api[path.split("?")[0]];
  if (v instanceof Error) throw v;
  if (typeof v === "function") return v(path);
  return v;
};
"""

DRIVER = r"""
;(async () => {
const out = {};
const fire = (type, detail) => (document.listeners[type] || []).forEach(f => f({ detail }));
const st = (name, extra) => ({ id: "stk-" + name, name, key: "g-" + name, image: "art", art: "milk.webp", image_url: null, found_count: 1, first_found_at: "2026-10-28T10:00:00", store: "Trader Joe's", ...extra });

// ---- pure helpers ----
const three = { kind: "aisle", size: 8, count: 3, stickers: [st("a"), st("b"), st("c")] };
let ch = albumSlots(three);
out.slots_one_chunk_of_8 = ch.length === 1 && ch[0].length === 8 && ch[0].filter(Boolean).length === 3 && ch[0][3] === null;
const eleven = { kind: "aisle", size: 8, count: 11, stickers: Array.from({ length: 11 }, (_, i) => st("s" + i)) };
ch = albumSlots(eleven);
out.slots_chunk_by_8 = ch.length === 2 && ch[0].length === 8 && ch[1].length === 8 && ch[1].filter(Boolean).length === 3;
out.slots_empty_page = albumSlots({ kind: "aisle", size: 8, count: 0, stickers: [] }).length === 1 && albumSlots({ kind: "aisle", stickers: [] })[0].every(x => x === null);
out.slots_other_4 = (c => c.length === 1 && c[0].length === 4)(albumSlots({ kind: "other", size: 4, count: 2, stickers: [st("a"), st("b")] }));
out.slots_other_6 = albumSlots({ kind: "other", size: 6, count: 6, stickers: Array.from({ length: 6 }, (_, i) => st("o" + i)) })[0].length === 6;
out.progress = albumProgressText(three) === "3 of 8" && albumProgressText({ kind: "other", size: 4, count: 2 }) === "2 of 4" && albumProgressText(eleven) === "11 stickers" && albumProgressText({ size: 8, count: 0 }) === "0 of 8";
out.src_cutout = albumStickerSrc({ image: "cutout", image_url: "/api/quest/stickers/x/image?v=1", art: "milk.webp" }) === "/api/quest/stickers/x/image?v=1";
out.src_art = albumStickerSrc({ image: "art", art: "milk.webp" }) === "assets/characters/milk.webp";
out.src_cutout_without_url = albumStickerSrc({ image: "cutout", image_url: null, art: "egg.webp" }) === "assets/characters/egg.webp";
out.src_default = albumStickerSrc({}) === "assets/characters/basket.webp" && albumStickerSrc(null) === "assets/characters/basket.webp";
const ns = albumNewSetFrom([{ name: " Milk " }, { name: "EGGS" }, { name: "" }, null]);
out.newset = ns.size === 2 && ns.has("milk") && ns.has("eggs") && albumNewSetFrom(undefined).size === 0 && albumNewSetFrom([]).size === 0;

// ---- level html ----
const LADDER = [
  { level: 2, title: "Avatar extras", kind: "expression", live: false, reached: true },
  { level: 4, title: "Pin a badge on your card", kind: "expression", live: false, reached: false },
  { level: 5, title: "Confirmer: check other shoppers' store changes", kind: "trust", live: false, reached: false } ];
const OPEN = ["Shop-Off race with friends", "Celebration sound"];
const prof = { level: 2, unlocks: { ladder: LADDER, open_to_all: OPEN, never_locked: ["Find it for me", "Receipts", "Lists", "Shop together", "Split the List"] } };
let html = albumLevelHtml(prof, 1);
out.level_big_numeral = html.includes('class="levelnum">2<');
out.level_gained_is_honest = html.includes("New at this level") && html.includes("Avatar extras") && !html.includes(">Live<") && (html.match(/>Coming soon</g) || []).length === 2;
out.level_next_coming_soon = html.includes("Pin a badge") && html.includes(">Coming soon<");
out.level_open_to_all_line = html.includes("Open to everyone: Shop-Off race with friends, Celebration sound.");
out.level_open_to_all_not_under_new = !html.split("Next")[0].includes("Shop-Off");
out.level_never_locked_line = html.includes("Never locked by level: Find it for me, Receipts, Lists, Shop together, Split the List.");
out.level_no_padlock = !/padlock|\u{1F512}|class="[^"]*\block\b/u.test(html) && !html.includes("&#128274;");
out.level_only_gained = !albumLevelHtml({ ...prof, level: 4 }, 2).includes("Avatar extras") && albumLevelHtml({ ...prof, level: 4 }, 2).includes("Pin a badge");
out.level_none_gained = albumLevelHtml({ level: 9, unlocks: { ladder: LADDER, never_locked: [] } }, 8).includes("Keep hunting");
out.level_live_chip_still_works = albumLevelHtml({ level: 2, unlocks: { ladder: [{ level: 2, title: "X", live: true, reached: true }] } }, 1).includes(">Live<");
out.level_no_ladder_is_safe = albumLevelHtml({ level: 2 }, 1).includes("levelnum");

// ---- the New sticker card ----
const card = () => __els["stk-card"];
const live2600 = () => __timers.filter(t => t.live && t.ms === 2600);
out.dom_injected = !!__els["view-album"] && !!__els["stk-card"] && !!__els["alb-sheet"] && !!__els["alb-level"];
out.card_starts_closed = AlbumUI.cardOpen() === false;
const items = [{ name: "Eggs", group: "g-Eggs", checked: true }, { name: "Milk", group: "g-Milk", checked: true }];
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }), is_new: true, page: "Dairy" } };
fire("arya:grabbed", { sid: "s1", name: "Milk", group: "g-Milk", boss: false, idx: 1 });
out.card_opens = AlbumUI.cardOpen() === true && card().hidden === false && card().innerHTML.includes("New sticker") && card().innerHTML.includes("Milk");
out.card_has_44_undo = card().innerHTML.includes('class="undo"') && card().innerHTML.includes(">Undo<");
out.card_consumes_new_sticker = !("new_sticker" in Q.current);
out.card_auto_dismiss_2600 = live2600().length === 1;
live2600()[0].fn();
out.card_closes_after_timer = AlbumUI.cardOpen() === false && card().innerHTML === "";
// Undo calls putBackStop with the item's index.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
card().listeners.click[0]({ target: { closest: sel => sel === "[data-stk-undo]" ? {} : null } });
out.undo_puts_back_right_index = __put.length === 1 && __put[0] === 1 && AlbumUI.cardOpen() === false;
// Another click target does nothing.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Eggs", { key: "g-Eggs" }) } };
fire("arya:grabbed", { name: "Eggs", group: "g-Eggs" });
card().listeners.click[0]({ target: { closest: () => null } });
out.other_click_keeps_card = AlbumUI.cardOpen() === true && __put.length === 1;
// A second card replaces the first.
const before = live2600().length;
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.second_card_replaces_first = card().innerHTML.includes("Milk") && !card().innerHTML.includes("Eggs") && live2600().length === 1 && before === 1;
live2600()[0].fn();
// Express never shows it, and still drops the payload.
Q.current = { id: "s2", mode: "express", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.express_skips_card = AlbumUI.cardOpen() === false && !("new_sticker" in Q.current);
// A stale payload for another item is ignored and deleted.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Bread", { key: "g-Bread" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.stale_ignored = AlbumUI.cardOpen() === false && !("new_sticker" in Q.current);
// No payload: nothing happens (a repeat find).
Q.current = { id: "s1", mode: "quest", items };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.no_payload_no_card = AlbumUI.cardOpen() === false;
// A second grab with no new sticker closes the first item's card, so
// the hunt can show its own toast and Undo (it skips them while a
// card is open). The first item keeps its Put back button.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
const hadCard = AlbumUI.cardOpen() === true && live2600().length === 1;
Q.current = { id: "s1", mode: "quest", items };
fire("arya:grabbed", { name: "Eggs", group: "g-Eggs" });
out.second_grab_without_sticker_closes_card = hadCard && AlbumUI.cardOpen() === false && card().innerHTML === "" && live2600().length === 0;
// A stale payload (for another item) closes the old card too.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Bread", { key: "g-Bread" }) } };
fire("arya:grabbed", { name: "Eggs", group: "g-Eggs" });
out.stale_payload_closes_old_card = AlbumUI.cardOpen() === false && !("new_sticker" in Q.current);
// A second grab WITH its own new sticker replaces the card.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Eggs", { key: "g-Eggs" }) } };
fire("arya:grabbed", { name: "Eggs", group: "g-Eggs" });
out.second_grab_with_sticker_swaps_card = AlbumUI.cardOpen() === true && card().innerHTML.includes("Eggs") && !card().innerHTML.includes("Milk");
fire("arya:putback", { name: "Eggs" });
// No session at all: still safe.
Q.current = null;
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.no_session_is_safe = AlbumUI.cardOpen() === false;
// Page badge line: the card says the page is full, never "earned".
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk" }), page_badge: { id: "Dairy", name: "Dairy Royalty" } } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.card_badge_line = card().innerHTML.includes("Page full. Add your receipt to earn Dairy Royalty.") && !card().innerHTML.includes("earned.");
// Put back closes the card.
fire("arya:putback", { name: "Milk" });
out.putback_closes = AlbumUI.cardOpen() === false;
// Cutout picture is used on the card.
Q.current = { id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { key: "g-Milk", image: "cutout", image_url: "/api/quest/stickers/q/image?v=1" }) } };
fire("arya:grabbed", { name: "Milk", group: "g-Milk" });
out.card_uses_cutout = card().innerHTML.includes("/api/quest/stickers/q/image?v=1");
AlbumUI.onNewSticker({ mode: "express" }, st("Milk"));
out.onNewSticker_express_direct = true;

// ---- level-up: first run silent, then once ----
out.level_first_run_silent = AlbumUI.maybeLevelUp({ level: 1, unlocks: { ladder: LADDER } }) === false && __els["alb-level"].hidden === true && localStorage.getItem("arya-album-level") === "1";
out.level_same_silent = AlbumUI.maybeLevelUp({ level: 1 }) === false;
const shown = AlbumUI.maybeLevelUp({ ...prof, level: 2 });
out.level_two_shows_once = shown === true && __els["alb-level"].hidden === false && __els["alb-level"].innerHTML.includes("Level up") && localStorage.getItem("arya-album-level") === "2";
__els["alb-level"].hidden = true;
out.level_not_again = AlbumUI.maybeLevelUp({ ...prof, level: 2 }) === false && __els["alb-level"].hidden === true;
out.level_never_lowers = AlbumUI.maybeLevelUp({ level: 1 }) === false && localStorage.getItem("arya-album-level") === "2";
out.level_bad_profile = AlbumUI.maybeLevelUp(null) === false && AlbumUI.maybeLevelUp({}) === false;
__els["alb-level"].listeners.click[0]({ target: { closest: s => s === "[data-alb-close]" ? {} : null } });
out.level_close_button = __els["alb-level"].hidden === true && __els["alb-level"].innerHTML === "";
// localStorage that throws: memory keeps the record.
const realLS = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
albMem.level = null;
out.level_blocked_first = AlbumUI.maybeLevelUp({ level: 1 }) === false;
out.level_blocked_up = AlbumUI.maybeLevelUp({ ...prof, level: 2 }) === true;
out.level_blocked_not_again = AlbumUI.maybeLevelUp({ ...prof, level: 2 }) === false;
globalThis.localStorage = realLS;

// ---- data helpers fail soft ----
__api["/api/quest/stickers/new"] = { new: [{ name: "Milk" }, { name: "Eggs" }] };
__api["/api/quest/stickers"] = { stickers: [st("Milk")] };
const nf = await albumNewFor({ id: "s1" });
out.newfor_ok = nf.has("milk") && nf.has("eggs") && (await albumNewFor("s1")).size === 2;
out.haul_ok = (await albumHaul("s1")).length === 1;
__api["/api/quest/stickers/new"] = new Error("down");
__api["/api/quest/stickers"] = new Error("down");
out.newfor_fail_empty = (await albumNewFor({ id: "s1" })).size === 0 && (await albumNewFor(null)).size === 0;
out.haul_fail_empty = (await albumHaul({ id: "s1" })).length === 0 && (await albumHaul(undefined)).length === 0;

// ---- the Album screen ----
const dairy = { id: "Dairy", title: "Dairy", kind: "aisle", size: 8, count: 3, stickers: [st("Milk"), st("Yogurt"), st("Cheese", { image: "cutout", image_url: "/api/quest/stickers/c/image?v=1" })],
  badge: { id: "Dairy", name: "Dairy Royalty", earned: false, earned_at: null, to_go: 5, text: "5 to go. No rush." }, started: true, note: null };
const other = { id: "Other finds", title: "Other finds", kind: "other", size: 4, count: 1, stickers: [st("Durian")], badge: null, started: true, note: "Items Arya cannot place yet land here." };
const hall = { id: "Halloween", title: "Halloween", kind: "season", size: 8, count: 0, stickers: [], badge: { id: "Halloween", name: "Pumpkin King", earned: false, to_go: 8, text: "8 to go. No rush." }, started: false, note: "Seasonal page. It starts when you find your first pumpkin item and never expires." };
__api["/api/quest/album"] = { total: 4, pages: [dairy, other, hall], chapters: [{ store: "Trader Joe's", pct: 71, earned: false, text: "Map all of Trader Joe's together: 71%. Each shelf you add helps." }] };
await renderAlbum();
let body = __els["alb-body"].innerHTML;
out.album_tabs = body.includes('data-alb-tab="Dairy"') && body.includes('data-alb-tab="Other finds"') && body.includes('data-alb-tab="Halloween"');
out.album_first_page = body.includes("3 of 8") && (body.match(/class="albslot empty"/g) || []).length === 5 && (body.match(/data-alb-slot=/g) || []).length === 3;
out.album_progress_bar = body.includes('class="albprog"') && body.includes("width:38%");
out.album_badge_row = body.includes("Dairy Royalty") && body.includes("5 to go. No rush.");
out.album_chapter = body.includes("Community chapter") && body.includes("71%") && body.includes("compass.webp");
out.album_cutout_in_slot = body.includes("/api/quest/stickers/c/image?v=1");
out.album_subtitle = __els["alb-sub"].textContent === "4 stickers collected" && __els["album-nav-sub"].textContent === "4 stickers";
out.album_private_line = body.includes("Your album is private.");
// Tabs switch pages.
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-tab]" ? { dataset: { albTab: "Other finds" } } : null } });
body = __els["alb-body"].innerHTML;
out.tab_other_finds = body.includes("1 of 4") && body.includes("Items Arya cannot place yet land here.") && (body.match(/class="albslot empty"/g) || []).length === 3;
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-tab]" ? { dataset: { albTab: "Halloween" } } : null } });
body = __els["alb-body"].innerHTML;
out.tab_season = body.includes("Seasonal") && body.includes("0 of 8") && body.includes("albslot empty season") && body.includes("never expires");
// The tab strip keeps its scroll position and shows the chosen tab.
const strip = { scrollLeft: 0, scrolledIntoView: 0,
  querySelector: s => s === '[aria-pressed="true"]' ? { scrollIntoView: o => { strip.scrolledIntoView++; strip.lastOpts = o; } } : null };
const bodyEl = __els["alb-body"];
let __html = bodyEl.innerHTML;
Object.defineProperty(bodyEl, "innerHTML", { get() { return __html; }, set(v) { __html = v; strip.scrollLeft = 0; }, configurable: true });
bodyEl.querySelector = s => s === ".albtabs" ? strip : null;
strip.scrollLeft = 240;
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-tab]" ? { dataset: { albTab: "Other finds" } } : null } });
out.tab_strip_keeps_scroll = strip.scrollLeft === 240;
out.tab_strip_shows_chosen_tab = strip.scrolledIntoView === 1 && strip.lastOpts.inline === "nearest";
delete bodyEl.querySelector;
// A slot opens the sheet.
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-tab]" ? { dataset: { albTab: "Dairy" } } : null } });
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-slot]" ? { dataset: { albSlot: "stk-Cheese" } } : null } });
let sheet = __els["alb-sheet"];
out.sheet_cutout = sheet.hidden === false && sheet.innerHTML.includes("Cheese") && sheet.innerHTML.includes("First found Oct 28, 2026 at Trader Joe&#39;s") && sheet.innerHTML.includes("Found in 1 hunt<") && sheet.innerHTML.includes("Only the product is kept in your album. No people.");
__els["alb-body"].listeners.click[0]({ target: { closest: s => s === "[data-alb-slot]" ? { dataset: { albSlot: "stk-Milk" } } : null } });
out.sheet_art_copy = sheet.innerHTML.includes("stock art") && !sheet.innerHTML.includes("No people.");
sheet.listeners.click[0]({ target: { closest: s => s === "[data-alb-close]" ? {} : null } });
out.sheet_closes = sheet.hidden === true;
// Empty album.
__api["/api/quest/album"] = { total: 0, pages: [], chapters: [] };
albState.view = null;
await renderAlbum();
body = __els["alb-body"].innerHTML;
out.album_empty_state = body.includes("No stickers yet.") && !body.includes("albtabs") && __els["album-nav-sub"].textContent === "No stickers yet";
// One sticker, singular.
__api["/api/quest/album"] = { total: 1, pages: [{ ...dairy, count: 1, stickers: [st("Milk")] }], chapters: [] };
await renderAlbum();
out.album_singular = __els["alb-sub"].textContent === "1 sticker collected" && __els["album-nav-sub"].textContent === "1 sticker";
// Failure bubbles to the caller (questGo shows the toast).
__api["/api/quest/album"] = new Error("down");
let failed = false; try { await renderAlbum(); } catch (e) { failed = true; }
out.album_error_bubbles = failed;

// ---- copy check on everything rendered ----
const BAN = new RegExp(__BANNED__, "i");
const rendered = [albumLevelHtml(prof, 1), albPageHtml(dairy), albPageHtml(other), albPageHtml(hall), albEmptyHtml(), albChaptersHtml([{ text: "x" }]), card().innerHTML, sheet.innerHTML].join(" ");
out.no_banned_words = !BAN.test(rendered);
console.log(JSON.stringify(out));
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestAlbumNode(unittest.TestCase):
    def test_album_js_runs_alone(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(read("album.js"))
                fh.write(DRIVER.replace("__BANNED__", json.dumps(BANNED)))
            out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"harness checks failed: {failed}")
        self.assertGreater(len(res), 50)


if __name__ == "__main__":
    unittest.main()
