"""Game: album, client. String pins over the album screen
(web/src/screens/Album.tsx), the New sticker card and the level-up
card (web/src/screens/album/), the Quest tab and album.css. The
behaviour the plain-JS app's node harness ran (pure helpers, the card
lifecycle with fake timers, the level-up card, the Album screen
render) is now web/src/screens/album/album.test.tsx (vitest)."""
import re
import unittest

from tests import frontend

BANNED = r"\b(lives|game over|timer|streak|hurry|penalty|retake|try again|incomplete|last place|failed|verified|cropped|frame deleted)\b"


def read(name):
    return frontend.read(name)


def strip_js_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", src)


def album_src():
    return "\n".join(frontend.src(f) for f in ("screens/Album.tsx", "screens/album/StickerCard.tsx",
                                               "screens/album/levelup.tsx"))


class TestAlbumPins(unittest.TestCase):
    def test_screen_registered_and_css_loaded(self):
        self.assertIn("album: Album,", frontend.src("screens/registry.tsx"))
        main = frontend.src("main.tsx")
        self.assertLess(main.index('import "./styles/styles.css"'), main.index('import "./styles/album.css"'))

    def test_nav_row_in_the_crew_group(self):
    # Your trips is history only (usability audit, owner-approved 2026-10-29).
        # The server album keeps its screen and route; Your trips no
        # longer links it (one album: the game's).
        quest = frontend.src("screens/Quest.tsx")
        self.assertNotIn('data-qnav="view-album"', quest)
        self.assertNotIn('id="album-nav-sub"', quest)
        self.assertIn("album: Album,", frontend.src("screens/registry.tsx"))

    def test_the_album_screen(self):
        js = frontend.src("screens/Album.tsx")
        for needle in ('id="alb-sub"', 'id="alb-body"', "qback", 'id="alb-sheet"'):
            self.assertIn(needle, js, needle)
        # A failed load says so and offers a retry, never a blank screen.
        self.assertIn("Could not load your album.", js)

    def test_crew_paints_the_nav_count_from_the_profile_it_already_loaded(self):
        quest = frontend.src("screens/Quest.tsx")
        self.assertEqual(quest.count('get("/api/quest/profile")'), 1)  # the avatar ring only
        self.assertNotIn("p.album", quest)
        self.assertNotIn("/api/quest/profile", strip_js_comments(frontend.src("screens/Album.tsx")))

    def test_badge_art_has_receipt_keeper(self):
        self.assertIn('receipt_keeper: "pantry.webp"', frontend.src("screens/QuestProgress.tsx"))

    def test_local_storage_is_always_in_try(self):
        js = album_src()
        hits = [m.start() for m in re.finditer(r"localStorage\.", js)]
        self.assertTrue(hits)
        for i in hits:
            self.assertIn("try {", js[max(0, i - 120):i])
        self.assertIn("arya-album-level", js)
        self.assertNotIn("arya-hunt-ui", js)
        for cancelled in ("arya-carry", "arya-pack-queue", "arya-queued"):
            self.assertNotIn(cancelled, js)

    def test_contract_names_exist(self):
        album = frontend.src("screens/Album.tsx")
        for name in ("slots", "progressText", "stickerSrc", "Album"):
            self.assertIn(f"export function {name}(", album)
        card = frontend.src("screens/album/StickerCard.tsx")
        self.assertIn("export const cardOpen", card)
        self.assertIn("export function stickerUndoIndex(", card)
        self.assertIn('"arya:grabbed"', card)
        self.assertIn('"arya:putback"', card)
        self.assertIn("delete sess.new_sticker", card)
        self.assertIn("ALB_CARD_MS = 2600", card)
        self.assertIn("export function maybeLevelUp(", frontend.src("screens/album/levelup.tsx"))
        # The hunt mounts the card; Score asks for the level-up.
        self.assertIn("<StickerCard", frontend.src("screens/Hunt.tsx"))
        self.assertIn("maybeLevelUp(profile)", frontend.src("screens/Score.tsx"))

    def test_copy(self):
        js = strip_js_comments(album_src())
        for s in ("New sticker", "Other finds", "No rush", "This season's stickers",
                  "Only the product is kept in your album. No people."):
            self.assertIn(s, js, s)
        self.assertNotRegex(js, r"(?i)frame deleted")
        # No emoji anywhere in the files.
        self.assertIsNone(re.search("[\U0001F300-\U0001FAFF\u2600-\u27BF]", js))

    def test_no_chat_no_trade_no_comment_surface(self):
        js = strip_js_comments(album_src()).lower()
        for bad in ("textarea", "<input", "comment", "trade", "chat", "price"):
            self.assertNotIn(bad, js, bad)

    def test_behaviour_lives_in_vitest(self):
        # The old node harness, ported: helpers, card, level-up, screen.
        t = frontend.src("screens/album/album.test.tsx")
        for name in ("pure helpers", "the New sticker card", "level up", "the Album screen"):
            self.assertIn(name, t)


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



if __name__ == "__main__":
    unittest.main()
