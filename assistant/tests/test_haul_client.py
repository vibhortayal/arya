"""Haul slice, client side: string pins over the React port
(web/src/screens/haul/*, Finish.tsx, Score.tsx) and haul.css. The pure
logic (HaulCore) and the e-receipt handler run under vitest in
web/src/screens/haul/haul.test.tsx; the screens' taps run in
web/e2e/haul.e2e.mjs and finish.e2e.mjs.

What these pin: the one hand-off from a closed hunt (afterFinish),
the three receipt paths, the honest copy (nothing is "verified", nothing
is "cropped"), no banned words, the Reveal rules (tap anywhere skips,
reduced motion is instant, Express stays quiet), the post payload
(stock art and names only, no price), and the stylesheet rules
(44px targets, tokens only, no gradient, no gold).
"""
import re
import unittest

from tests import frontend

BANNED = ("lives", "game over", "timer", "streak", "hurry", "penalty",
          "retake", "try again", "incomplete", "last place", "failed",
          "verified", "cropped", "frame deleted")

HAUL = ("screens/haul/core.ts", "screens/haul/state.ts", "screens/haul/Reveal.tsx",
        "screens/haul/ReceiptReview.tsx", "screens/haul/HaulCard.tsx",
        "screens/haul/CrewFeed.tsx", "screens/haul/ScoreRow.tsx")


def read(name):
    return frontend.read(name)


def src(rel):
    return frontend.src(rel)


def haul():
    return "\n".join(src(f) for f in HAUL)


def finish_section():
    return src("screens/Finish.tsx")


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"\{/\*.*?\*/\}", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def func_body(text, header):
    """From a header to the next top-level declaration."""
    a = text.index(header)
    m = re.search(r"\n(?:export )?(?:async )?(?:function |const |type )", text[a + len(header):])
    return text[a:a + len(header) + (m.start() if m else len(text))]


class TestHaulHooks(unittest.TestCase):
    def test_score_and_finish_hooks(self):
        fin = src("screens/Finish.tsx")
        self.assertIn("await afterFinish(nav, sess, { replace: true });", fin)
        score = src("screens/Score.tsx")
        self.assertIn("<ScoreRow sess={sess} attached={attached} />", score)
        self.assertIn("if (profile) maybeLevelUp(profile);", score)
        self.assertIn("const c = await shareReady(sess, toast);", score)
        # Share as video waits for the haul view; it never falls back to
        # the plain hunt, which would show hidden and removed stickers.
        self.assertIn('if (kind !== "haul") { setShare({ kind, ctx: base }); return; }', score)
        photo = src("screens/score/HaulPhoto.tsx")
        self.assertIn(">Share your haul</button>", photo)
        self.assertIn('id="share-haul"', photo)
        # The late receipt walks the same road as the first one.
        self.assertIn("afterFinish(nav, sess); }} />", score)
        sheet = src("ui/AddReceiptSheet.tsx")
        self.assertIn('action: "See haul"', sheet)
        # A caller that already opens the review gets no second way there.
        self.assertIn("goesToHaul ? undefined :", sheet)
        self.assertIn("goesToHaul onClose", score)
        self.assertIn("goesToHaul onClose", src("screens/haul/Reveal.tsx"))
        # The Crew feed rides the Quest tab's news block (off while the
        # tab has none, as in the old app).
        self.assertIn("{HAS_COMM_NEWS && <CrewFeed />}", src("screens/Quest.tsx"))

    def test_profile_fetch_then_levelup_order(self):
        score = src("screens/Score.tsx")
        a = score.index('let profile = await get<Profile>("/api/quest/profile")')
        b = score.index("maybeLevelUp(profile)")
        self.assertLess(a, b)
        self.assertLess(b - a, 200)

    def test_untouched_regions(self):
        # The plan and the hunt rewards know nothing of the haul.
        for f in ("screens/NewList.tsx", "screens/hunt/fx.ts", "screens/hunt/model.ts"):
            self.assertNotIn("haul/state", src(f), f)
        # afterFinish has three callers: Finish, the late receipt
        # (Score, Reveal) and See haul (the Add receipt sheet).
        self.assertIn("afterFinish(nav, sess, { replace: true })", src("screens/Finish.tsx"))
        self.assertIn("afterFinish(nav, sess)", src("ui/AddReceiptSheet.tsx"))

    def test_stylesheet_is_loaded(self):
        main = src("main.tsx")
        self.assertIn('import "./styles/haul.css";', main)
        self.assertLess(main.index('import "./styles/styles.css"'), main.index('import "./styles/haul.css"'))
        reg = src("screens/registry.tsx")
        for v in ("reveal: Reveal", "rreview: ReceiptReview", "haul: HaulCard"):
            self.assertIn(v, reg)


class TestReceiptStep(unittest.TestCase):
    def test_three_paths(self):
        fin = finish_section()
        for needle in ('id="fin-photo"', 'id="fin-ereceipt"', 'id="fin-skip"',
                       "Snap the receipt", "e-receipt", ">No receipt today</button>",
                       'id="fin-sample"', 'accept="application/pdf,image/*"'):
            self.assertIn(needle, fin)
        self.assertIn("Add an e-receipt (PDF or screenshot)", fin)
        self.assertIn("Add your receipt", fin)

    def test_honest_copy(self):
        fin = finish_section()
        self.assertIn("Arya reads items and the total. Your photo stays private to you. Nothing here is shared.", fin)
        self.assertIn("Your +50 bonus waits. It never expires.", fin)
        self.assertIn("A blurry or partial photo is fine. Arya keeps what it can read.", fin)
        self.assertNotIn("loyalty", fin.lower())

    def test_ereceipt_wiring(self):
        fin = finish_section()
        self.assertIn('id="fin-ereceipt"', fin)
        self.assertIn("onChange={onEreceipt}", fin)
        self.assertIn("rid = (await decode(f)).receipt.receipt_id;", fin)
        self.assertIn("await closeToScore(attach(rid));", fin)
        sheet = src("ui/AddReceiptSheet.tsx")
        self.assertIn('"/decode/pdf"', sheet)
        self.assertIn('"Content-Type": pdf ? "application/pdf"', sheet)

    def test_after_finish_rules(self):
        st = src("screens/haul/state.ts")
        body = func_body(st, "export async function afterFinish")
        self.assertIn('sess.state === "done" && sess.receipt_id', body)
        self.assertIn('enter(nav, "rreview", sess, d)', body)
        nxt = func_body(st, "export function next(")
        self.assertIn('sess.mode === "express" ? openScore(nav, sess, go) : enter(nav, "reveal", sess)', nxt)


class TestCopyAndWords(unittest.TestCase):
    def test_review_and_reveal_copy(self):
        js = haul().lower()
        for needle in ("Check your receipt", "Fix anything that looks off.",
                       "Add another receipt", "Looks right", "Add to album",
                       "Leave out", "Paid another way? Keep it.",
                       "Remove from haul", "tap anywhere", "It never expires",
                       "Golden item: next time", "Make my haul card",
                       "Add receipt now", "Trip summary", "Named by Arya",
                       "Save as image", "Share with friends", "Delete post",
                       "No friends added yet.", "Add a friend",
                       "No prices, no store photos, no people.",
                       "Shared with your friends", "Same haul", "Example only",
                       "In next quest · Undo", "Estimate vs receipt (only you see this)",
                       "Replay the reveal", "See my album",
                       "Receipt bonus waiting."):
            self.assertIn(needle.lower(), js, needle)

    def test_no_banned_or_dishonest_words(self):
        for name, text in (("haul screens", strip_comments(haul())),
                           ("finish screen", strip_comments(finish_section())),
                           ("haul.css", read("haul.css"))):
            low = text.lower()
            for w in BANNED:
                if w == "lives":
                    self.assertIsNone(re.search(r"\blives\b", low), f"{w} in {name}")
                else:
                    self.assertNotIn(w, low, f"{w} in {name}")

    def test_share_caption_has_no_verified(self):
        js = src("screens/haul/Share.tsx")
        self.assertNotIn("verified", js.lower())
        self.assertIn('caption: "My haul on Arya."', js)

    def test_boss_reveal_is_truthful(self):
        js = src("screens/haul/Reveal.tsx")
        self.assertIn('status === "found"', js)
        self.assertIn("qBossStatus(sess)", js)
        # The boss row exists only when a boss existed.
        self.assertIn("{d.boss && (status", js)

    def test_no_free_text_in_crew_ui(self):
        js = haul()
        self.assertNotIn("<textarea", js)
        self.assertNotIn('type="text"', js)
        self.assertNotIn("prompt(", js)
        for k in ("yum", "me_too", "teach_me"):
            self.assertIn(f'"{k}"', js)

    def test_no_price_in_post_or_card(self):
        core, card, st = src("screens/haul/core.ts"), src("screens/haul/HaulCard.tsx"), src("screens/haul/state.ts")
        slices = {
            "postPayload": func_body(core, "export function postPayload"),
            "HaulCard": strip_comments(card),
            "shareCtx": func_body(st, "export function shareCtx"),
        }
        for name, body in slices.items():
            low = body.lower()
            for w in ("money(", "estimate", "receipt_id", "d.private", "image_url",
                      "$" + "{p.total", "subtotal"):
                self.assertNotIn(w, low, f"{w} in {name}")
        self.assertNotIn("price", slices["postPayload"].lower())
        self.assertNotIn("store", slices["postPayload"].lower())
        # The post sends art file names from the stock set, never a cutout.
        self.assertIn("postPayload(d.items.map(i => ({ name: i.name, art: art(i.name) })))", card)

    def test_reveal_motion_rules(self):
        js = src("screens/haul/Reveal.tsx")
        self.assertIn("if (reduced()) { showAll();", js)
        self.assertIn("prefers-reduced-motion: reduce", src("screens/haul/state.ts"))
        self.assertIn("cancelAnimationFrame(raf.current)", js)
        self.assertIn("const skipReveal = () => {", js)
        self.assertIn('if (!(ev.target as Element).closest("button, a, label, input")) skipRef.current();', js)
        # Express never plays the Reveal.
        self.assertIn('sess.mode === "express"', src("screens/haul/state.ts"))

    def test_localstorage_is_guarded(self):
        js = haul()
        for m in re.finditer(r"localStorage", js):
            window = js[max(0, m.start() - 400):m.start()]
            self.assertIn("try {", window)

    def test_album_calls_are_guarded(self):
        # The album's side of the haul fails soft: an empty answer and
        # the screens fall back to the character art.
        st = src("screens/haul/state.ts")
        body = func_body(st, "export async function stickersFor")
        self.assertIn("catch { stickers = []; }", body)
        self.assertIn("catch { fresh = new Set(); }", body)
        self.assertNotIn("maybeLevelUp", haul())


class TestHaulCss(unittest.TestCase):
    def setUp(self):
        self.raw = read("haul.css")
        self.css = re.sub(r"/\*.*?\*/", "", self.raw, flags=re.S)  # comments out

    def rule(self, selector):
        m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", self.css)
        self.assertIsNotNone(m, selector)
        return m.group(1)

    def test_touch_targets(self):
        for sel in (".hl-flat button", ".hl-react", ".rv-fix", ".hl-pick"):
            self.assertRegex(self.rule(sel), r"min-height:\s*44px", sel)
        self.assertRegex(self.rule(".hl-flat button"), r"min-width:\s*44px")
        self.assertRegex(self.rule(".hl-flat button img"), r"width:\s*54px")

    def test_tokens_only(self):
        self.assertNotRegex(self.css, r"#[0-9a-fA-F]{3,8}\b")
        self.assertNotRegex(self.css, r"rgba?\(")
        self.assertNotIn("gradient", self.css)
        for gold in ("gold", "yellow", "amber"):
            self.assertNotIn(gold, self.css.lower())
        self.assertIn("var(--acc)", self.css)
        self.assertIn("var(--acc-soft)", self.css)

    def test_reduced_motion_rule(self):
        m = re.search(r"@media \(prefers-reduced-motion: reduce\)\s*\{(.*)\}\s*$", self.css, re.S)
        self.assertIsNotNone(m)
        self.assertIn(".rv-tile", m.group(1))
        self.assertIn("opacity: 1", m.group(1))

    def test_prefixes_only(self):
        classes = set(re.findall(r"\.([a-z][a-z0-9_-]*)", re.sub(r"\{[^}]*\}", "{}", self.css)))
        for c in classes:
            if c in ("grow", "name", "sub", "hid", "in", "btn"):
                continue  # descendants of rv-/hl- parents, and state words
            self.assertRegex(c, r"^(rv|hl)-", c)

    def test_font_sizes(self):
        for m in re.finditer(r"font-size:\s*(\d+)px", self.css):
            n = int(m.group(1))
            self.assertTrue(n >= 15 or n == 12, f"font-size {n}px")

    def test_spec_classes_exist(self):
        for sel in (".rv-loot", ".rv-new", ".rv-boss", ".rv-pts", ".rv-lines",
                    ".rv-fix", ".hl-card", ".hl-flat", ".hl-stats", ".hl-react",
                    ".hl-pick"):
            self.assertIn(sel, self.css, sel)
        self.assertRegex(self.rule(".rv-pts"), r"font-size:\s*52px")
        self.assertRegex(self.rule(".rv-pts"), r"tabular-nums")
        self.assertRegex(self.rule(".rv-boss"), r"2px solid var\(--acc\)")
        self.assertRegex(self.rule(".rv-loot"), r"repeat\(4,")


class TestShareSpec(unittest.TestCase):
    def test_spec_haul(self):
        js = src("screens/haul/Share.tsx")
        body = js[js.index("function specHaul"):js.index("function specLove")]
        self.assertIn("ctx.hidden", body)
        self.assertIn("ctx.title", body)
        self.assertIn("ctx.stats", body)
        self.assertIn("new · level", body)
        self.assertIn('"Level {{level}}"', body)
        for w in ("pts", "price", "total", "sess.store"):
            self.assertNotIn(w, body)


class TestHaulCoreUnderNode(unittest.TestCase):
    def test_pure_logic(self):
        # Ported to vitest: count-up, hide toggle, audience, Same haul
        # pick and toast, private lines, post payload, labels, sample.
        t = src("screens/haul/haul.test.tsx")
        for name in ("count-up is monotonic", "hide toggle round trip", "audience words",
                     "Same haul: list and queued items", "the toast counts what the server queued",
                     "the private estimate never sets a partial sum", "a post carries a name and a stock art file",
                     "labels and the sample card"):
            self.assertIn(name, t)


class TestFinishHandlerUnderNode(unittest.TestCase):
    def test_ereceipt_handler(self):
        # Ported to vitest: a PDF (by type or name) to /decode/pdf, a
        # picture to the photo reader, read failure vs attach refusal,
        # no file no work.
        t = src("screens/haul/haul.test.tsx")
        for name in ("a PDF, by type or by name, goes to /decode/pdf", "closes the hunt, then attaches",
                     "a read failure says so", "an attach refusal is not 'could not read'", "no file, no work"):
            self.assertIn(name, t)


class TestReviewReopen(unittest.TestCase):
    """Review fixes: the receipt review opens again, a grab with no
    receipt line stays in the haul, and the count-up is silent."""

    def test_review_can_be_reopened_from_score_and_reveal(self):
        row = src("screens/haul/ScoreRow.tsx")
        self.assertIn('data-hl="review"', row)
        self.assertIn("Check your receipt", row)
        self.assertIn("sess.receipt_id", row)
        self.assertIn("canReview(sess, d)", row)
        self.assertIn('enter(nav, "rreview", sess)', row)
        reveal = src("screens/haul/Reveal.tsx")
        self.assertIn('data-act="review"', reveal)
        self.assertIn("{canReview(sess, d) && <p>", reveal)
        self.assertIn('onClick={() => enter(nav, "rreview", sess)}', reveal)
        can = func_body(src("screens/haul/state.ts"), "export function canReview")
        self.assertIn("d.review.read > 0", can)
        self.assertIn("sess.receipt_id", can)

    def test_reopen_reads_the_live_haul(self):
        rr = src("screens/haul/ReceiptReview.tsx")
        self.assertIn("fetchHaul(sess).then(v => { if (live) setD(v); })", rr)
        self.assertNotIn("H.cache[sess.id] ||", rr)

    def test_grabbed_items_stay_unless_the_shopper_removes_them(self):
        rr = src("screens/haul/ReceiptReview.tsx")
        self.assertIn("They stay in your haul.", rr)
        self.assertIn("Paid another way? Keep it.", rr)
        self.assertIn('r.grabbed_only.map(e => row("grabbed_only", e,', rr)
        self.assertIn('"In your haul", "no"))', rr)
        self.assertIn('const cs = chips === "no" ? [chip(bucket as Bucket, e, "no")]', rr)

    def test_countup_has_no_live_region(self):
        js = src("screens/haul/Reveal.tsx")
        num = js[js.index('id="rv-pts"'):]
        num = num[:num.index("</p>")]
        self.assertNotIn("aria-live", num)
        self.assertIn('aria-hidden="true"', num)
        # One quiet live node, set once when the count ends.
        self.assertIn('id="rv-pts-sr" role="status" aria-live="polite"', js)
        self.assertEqual(js.count("announce(target)"), 2)
        self.assertIn("announce(fin.value)", js)
        step = js[js.index("const setNumber"):js.index("const announce")]
        self.assertNotIn("rv-pts-sr", step)
        self.assertIn(".rv-sr", read("haul.css"))

    def test_raw_receipt_names_make_no_sticker(self):
        rr = src("screens/haul/ReceiptReview.tsx")
        self.assertIn('if (send === "extra_add" && found.entry.decoded) {', rr)

    def test_share_waits_for_the_haul_view(self):
        ready = func_body(src("screens/haul/state.ts"), "export async function shareReady")
        self.assertIn("await fetchHaul(sess)", ready)
        self.assertIn("return null;", ready)
        self.assertIn("return shareCtx(sess)", ready)

    def test_pdf_choice_is_hidden_in_the_demo(self):
        fin = finish_section()
        self.assertIn('className="nomargin real-only"', fin)
        self.assertIn("hidden={demo}", fin.split("real-only")[1].split(">")[0])

    def test_hide_and_same_haul_report_the_truth(self):
        card = src("screens/haul/HaulCard.tsx")
        self.assertIn("d.post && d.post.taken_down", card)
        self.assertIn("Post taken down. Nothing is left to show.", card)
        feed = src("screens/haul/CrewFeed.tsx")
        self.assertIn("toast(sameToast(queuedCount(res.queued, p.post_id), names.length));", feed)
        self.assertNotIn("plural(names.length", feed)
        self.assertIn('get("/api/quest/queued")', feed)
        self.assertIn("queuedNames", feed)


if __name__ == "__main__":
    unittest.main()
