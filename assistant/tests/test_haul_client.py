"""Haul slice, client side: string pins over pwa/*.js, index.html and
haul.css, plus the pure logic (HaulCore) executed under node when node
is on the machine.

What these pin: the one hand-off from a closed hunt (HaulUI.afterFinish),
the three receipt paths, the honest copy (nothing is "verified", nothing
is "cropped"), no banned words, the Reveal rules (tap anywhere skips,
reduced motion is instant, Express stays quiet), the post payload
(stock art and names only, no price), and the stylesheet rules
(44px targets, tokens only, no gradient, no gold).
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = shutil.which("node")

BANNED = ("lives", "game over", "timer", "streak", "hurry", "penalty",
          "retake", "try again", "incomplete", "last place", "failed",
          "verified", "cropped", "frame deleted")


def read(name):
    with open(os.path.join(HERE, "..", "pwa", name), encoding="utf-8") as fh:
        return fh.read()


def finish_section():
    html = read("index.html")
    a = html.index('<section id="view-finish"')
    return html[a:html.index("</section>", a)]


def func_body(src, header):
    """The text of a function from its header to the next top-level
    function or the end of the file."""
    a = src.index(header)
    m = re.search(r"\n(?:async )?function |\n\$\(", src[a + len(header):])
    return src[a:a + len(header) + (m.start() if m else len(src))]


class TestHaulHooks(unittest.TestCase):
    def test_quest_js_hooks(self):
        q = read("quest.js")
        close = func_body(q, "async function closeToScore")
        self.assertIn("if (window.HaulUI) HaulUI.afterFinish(sess); else openScore(sess);", close)
        score = func_body(q, "async function openScore")
        self.assertIn("HaulUI.scoreRow(sess, attached)", score)
        self.assertIn("if (window.AlbumUI && profile) AlbumUI.maybeLevelUp(profile);", score)
        self.assertIn("HaulUI.shareReady(sess)", score)
        # Share as video waits for the haul view; it never falls back to
        # the plain hunt, which would show hidden and removed stickers.
        self.assertNotIn("HaulUI.shareCtx(sess) : { sess }", score)
        self.assertIn(">Share your haul</button>", score)
        self.assertIn('id="share-haul"', score)
        # The late receipt walks the same road as the first one.
        self.assertIn("HaulUI.afterFinish(sess)", score)
        settle = func_body(q, "async function qArSettle")
        self.assertIn('action: "See haul"', settle)
        # A caller that already opens the review gets no second way there.
        self.assertIn("!goesToHaul", settle)
        self.assertIn("{ goesToHaul: !!window.HaulUI }", score)
        self.assertIn("goesToHaul: true", read("haul.js"))
        comm = func_body(q, "async function renderCommunity")
        self.assertIn("HaulUI.paintFeed()", comm)

    def test_profile_fetch_then_levelup_order(self):
        score = func_body(read("quest.js"), "async function openScore")
        a = score.index('profile = await api("/api/quest/profile")')
        b = score.index("AlbumUI.maybeLevelUp(profile)")
        self.assertLess(a, b)
        self.assertLess(b - a, 200)

    def test_untouched_regions(self):
        q = read("quest.js")
        # This slice does not edit the plan or the hunt rewards.
        self.assertNotIn("HaulUI", func_body(q, "async function renderPlan") if "async function renderPlan" in q else "")
        self.assertNotIn("HaulUI", func_body(q, "function qHaulHtml"))
        self.assertNotIn("HaulUI", func_body(q, "async function qDecodeReceipt") if "async function qDecodeReceipt" in q else "")
        self.assertEqual(q.count("HaulUI.afterFinish"), 3)  # close, late receipt, See haul

    def test_script_and_link_in_index(self):
        html = read("index.html")
        self.assertIn('<link rel="stylesheet" href="haul.css">', html)
        self.assertIn('<script src="haul.js"></script>', html)
        self.assertLess(html.index('src="share.js"'), html.index('src="haul.js"'))
        self.assertLess(html.index('href="styles.css"'), html.index('href="haul.css"'))

    def test_no_edits_outside_the_slice(self):
        # The integrator precaches every game file.
        sw = read("sw.js")
        for f in ("haul.js", "haul.css"):
            self.assertIn('"/' + f + '"', sw)


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
        js = read("haul.js")
        self.assertIn('"#fin-ereceipt"', js)
        self.assertIn("/decode/pdf", js)
        self.assertIn('"Content-Type": "application/pdf"', js)
        self.assertIn("qDecodeReceipt(file)", js)
        self.assertIn("closeToScore(sess, () => qAttach(sess.id, rid))", js)

    def test_after_finish_rules(self):
        js = read("haul.js")
        body = func_body(js, "  async function afterFinish")
        self.assertIn('sess.state === "done" && sess.receipt_id', body)
        self.assertIn("openReview(sess, d)", body)
        nxt = func_body(js, "  function next(sess)")
        self.assertIn('sess.mode === "express" ? openScore(sess) : openReveal(sess)', nxt)


class TestCopyAndWords(unittest.TestCase):
    def test_review_and_reveal_copy(self):
        js = read("haul.js")
        for needle in ("Check your receipt", "Fix anything that looks off.",
                       "+ Add another receipt", "Looks right", "Add to album",
                       "Leave out", "Paid another way? Keep it.",
                       "Remove from haul", "tap anywhere", "It never expires",
                       "Boss item: next time", "Make my haul card",
                       "Add receipt now", "Trip summary", "Named by Arya",
                       "Save as image", "Post to Crew", "Delete post",
                       "You have no Crew yet.", "Add a friend",
                       "No prices, no store photos, no people.",
                       "Posted to your Crew", "Same haul", "Example only",
                       "In next hunt · Undo", "Estimate vs actual (only you)",
                       "Replay the reveal", "See my album",
                       "Receipt bonus waiting."):
            self.assertIn(needle.lower(), js.lower(), needle)

    def test_no_banned_or_dishonest_words(self):
        for name, text in (("haul.js", read("haul.js")),
                           ("finish section", finish_section()),
                           ("haul.css", read("haul.css"))):
            low = text.lower()
            for w in BANNED:
                if w == "lives":
                    self.assertIsNone(re.search(r"\blives\b", low), f"{w} in {name}")
                else:
                    self.assertNotIn(w, low, f"{w} in {name}")

    def test_share_caption_has_no_verified(self):
        js = read("share.js")
        self.assertNotIn("verified", js.lower())
        self.assertIn('caption: "My haul on Arya."', js)

    def test_boss_reveal_is_truthful(self):
        js = read("haul.js")
        self.assertIn('status === "found"', js)
        self.assertIn("qBossStatus(sess)", js)
        # The boss row exists only when a boss existed.
        self.assertIn("if (d.boss) {", js)

    def test_no_free_text_in_crew_ui(self):
        js = read("haul.js")
        self.assertNotIn("<textarea", js)
        self.assertNotIn('type="text"', js)
        self.assertNotIn("prompt(", js)
        for k in ("yum", "me_too", "teach_me"):
            self.assertIn(f'"{k}"', js)

    def test_no_price_in_post_or_card(self):
        js = read("haul.js")
        slices = {
            "postPayload": js[js.index("function postPayload"):js.index("function sampleHaul")],
            "paintCard": js[js.index("async function paintCard"):js.index("async function toggleHide")],
            "postSheet": js[js.index("function paintPostSheet"):js.index("/* ---------- the Score screen")],
            "shareCtx": js[js.index("function shareCtx"):js.index("/* ---------- the Crew feed")],
        }
        for name, body in slices.items():
            low = body.lower()
            for w in ("money(", "estimate", "receipt_id", "d.private", "image_url",
                      "$"  + "{p.total", "subtotal"):
                self.assertNotIn(w, low, f"{w} in {name}")
        self.assertNotIn("price", slices["postPayload"].lower())
        self.assertNotIn("store", slices["postPayload"].lower())
        # The post sends art file names from the stock set, never a cutout.
        self.assertIn("art(i.name)", slices["postSheet"])

    def test_reveal_motion_rules(self):
        js = read("haul.js")
        self.assertIn("prefers-reduced-motion: reduce", js)
        self.assertIn("cancelAnimationFrame(H.raf)", js)
        self.assertIn("function skipReveal", js)
        self.assertIn("if (!btn) { skipReveal(); return; }", js)
        # Express never plays the Reveal.
        self.assertIn('sess.mode === "express"', js)

    def test_localstorage_is_guarded(self):
        js = read("haul.js")
        for m in re.finditer(r"localStorage", js):
            window = js[max(0, m.start() - 400):m.start()]
            self.assertIn("try {", window)

    def test_album_calls_are_guarded(self):
        js = read("haul.js")
        for g in ("window.albumHaul", "window.albumNewFor", "window.albumStickerSrc", "window.renderAlbum"):
            self.assertIn(g, js)
        self.assertNotIn("AlbumUI.", js)


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
        js = read("share.js")
        body = js[js.index("function specHaul"):js.index("function specLove")]
        self.assertIn("ctx.hidden", body)
        self.assertIn("ctx.title", body)
        self.assertIn("ctx.stats", body)
        self.assertIn("new · level", body)
        self.assertIn("`Level ${level}`", body)
        for w in ("pts", "price", "total", "sess.store"):
            self.assertNotIn(w, body)


CORE_DRIVER = r"""
const src = require('fs').readFileSync(process.argv[2], 'utf8');
const a = src.indexOf('/*HAULCORE-START*/'), b = src.indexOf('/*HAULCORE-END*/');
const window = {};
eval(src.slice(a, b) + '; window.HC = HaulCore;');
const H = window.HC, out = {};

// countStep: monotonic, starts at from, ends exactly at the target.
let prev = -1, mono = true;
for (let i = 0; i <= 100; i++) {
  const v = H.countStep(0, 137, i / 100);
  if (v < prev) mono = false;
  prev = v;
}
out.count_monotonic = mono;
out.count_start = H.countStep(0, 137, 0) === 0;
out.count_end = H.countStep(0, 137, 1) === 137 && H.countStep(0, 137, 7) === 137;
out.count_zero_target = H.countStep(0, 0, 0.5) === 0;

// the Reveal staggers tiles with CSS transition-delay; no JS tile counter.
out.no_dead_helper = H.tilesVisible === undefined;

// tap anywhere: every tile shown, number at target.
const fin = H.revealFinal(137, 9);
out.skip_final = fin.shown === 9 && fin.value === 137;

// hide toggle round trip, no mutation of the input.
const s0 = new Set(['milk']);
const s1 = H.toggleHidden(s0, 'eggs');
const s2 = H.toggleHidden(s1, 'eggs');
out.toggle_add = s1.has('eggs') && s1.has('milk') && !s0.has('eggs');
out.toggle_round = s2.size === 1 && s2.has('milk') && !s2.has('eggs');

// audience text for 0, 1, 2, 3 and 5.
out.aud0 = H.sheetAudienceText([]) === '';
out.aud1 = H.sheetAudienceText(['priya']) === '@priya';
out.aud2 = H.sheetAudienceText(['priya', 'dev']) === '@priya and @dev';
out.aud3 = H.sheetAudienceText(['a', 'b', 'c']) === '@a, @b and @c';
out.aud5 = H.sheetAudienceText(['priya', 'dev', 'x', 'y', 'z']) === '@priya, @dev and 3 more';

// Same haul: items already on the list start unticked.
const rows = H.queuePick([{name: 'Whole Milk'}, {name: 'Mandarins'}, 'Bananas'], ['milk', 'Bananas']);
out.pick_milk = rows[0].checked === false && rows[0].note === 'Already on your list';
out.pick_mand = rows[1].checked === true && rows[1].note === '';
out.pick_ban = rows[2].checked === false;
out.pick_nolist = H.queuePick(['a', 'b'], []).every(r => r.checked);
// Items another post already queued start unticked and say so.
const rq = H.queuePick(['Kiwi', 'Pears', 'Whole Milk'], ['milk'], ['kiwi!']);
out.pick_queued = rq[0].checked === false && rq[0].note === 'Already in your next hunt';
out.pick_free = rq[1].checked === true && rq[1].note === '';
out.pick_list_note = rq[2].checked === false && rq[2].note === 'Already on your list';

// The toast counts what the server queued, never the ticks.
const qrows = [{post_id: 'a'}, {post_id: 'b'}, {post_id: 'a'}];
out.queued_count = H.queuedCount(qrows, 'a') === 2 && H.queuedCount(qrows, 'z') === 0 && H.queuedCount(null, 'a') === 0;
out.toast_zero = /Nothing new/.test(H.sameToast(0, 3));
out.toast_all = H.sameToast(3, 3) === '3 items added to your next hunt.';
out.toast_one = H.sameToast(1, 1) === '1 item added to your next hunt.';
out.toast_some = H.sameToast(2, 3).startsWith('2 items added to your next hunt.') && /rest were there already/.test(H.sameToast(2, 3));

// The private estimate never sets a partial sum against the whole receipt.
const fmt = n => '$' + Number(n).toFixed(0);
const full = H.privateLines({estimate: 18, estimate_items: 5, grabbed_items: 5, actual: 20}, fmt);
out.priv_full = full.length === 1 && full[0].text === 'About $18 · Receipt $20';
const part = H.privateLines({estimate: 18, estimate_items: 3, grabbed_items: 12, actual: 120}, fmt);
out.priv_part = part.length === 2 && part[0].text === 'About $18 for 3 of 12 items' && part[1].text === '$120'
  && !/Receipt/.test(part[0].text);
out.priv_none = H.privateLines(null, fmt).length === 0 && H.privateLines({estimate: null, actual: null}, fmt).length === 0;
const onlyActual = H.privateLines({estimate: null, estimate_items: 0, grabbed_items: 4, actual: 9}, fmt);
out.priv_actual_only = onlyActual.length === 1 && onlyActual[0].text === 'Receipt $9';

// The post payload carries a name and an art file, nothing else.
const p = H.postPayload([{name: 'Milk', art: 'milk.webp', price: 3.99, store: 'X', image_url: '/u'}, {name: 'Eggs'}]);
out.payload_keys = p.items.every(i => Object.keys(i).sort().join() === 'art,name');
out.payload_default = p.items[1].art === 'basket.webp';
out.payload_no_price = !JSON.stringify(p).match(/price|store|image_url|3\.99/);

// labels
out.stats = H.statsLabel({items: 9, new: 2, level: 4}) === '9 items · 2 new · level 4';
out.fix_labels = H.fixLabel('on_receipt_only').yes === 'Add to album' && H.fixLabel('on_receipt_only').no === 'Leave out'
  && H.fixLabel('grabbed_only').yes === 'Keep' && H.fixLabel('grabbed_only').no === 'Remove from haul';
out.sample = H.sampleHaul().sample === true && H.sampleHaul().items.length === 9;
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node not available")
class TestHaulCoreUnderNode(unittest.TestCase):
    def test_pure_logic(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(CORE_DRIVER)
            path = fh.name
        try:
            out = subprocess.run(
                [NODE, path, os.path.join(HERE, "..", "pwa", "haul.js")],
                capture_output=True, text=True, timeout=60)
        finally:
            os.unlink(path)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        bad = [k for k, v in res.items() if v is not True]
        self.assertEqual(bad, [], f"HaulCore checks failed: {bad} in {res}")


# The e-receipt handler (wireFinish, decodeAny) run under node with a
# stubbed DOM, fetch and quest.js helpers. haul.js is loaded whole.
FINISH_DRIVER = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const out = {};

function world(opts) {
  const w = { toasts: [], fetches: [], closed: [], attached: [], decoded: [] };
  const inp = { files: [], value: 'x', addEventListener: (t, fn) => { if (t === 'change') inp.h = fn; } };
  const status = { textContent: '' };
  const document = {
    querySelector: s => (s === '#fin-ereceipt' ? inp : s === '#fin-status' ? status : null),
    querySelectorAll: () => [], addEventListener: () => {},
    body: { insertAdjacentHTML: () => {} }
  };
  const fetch = async (url, init) => {
    w.fetches.push({ url, init });
    if (opts.pdfFails) return { ok: false, status: 403, json: async () => ({ detail: 'this needs a real account' }) };
    return { ok: true, status: 200, json: async () => ({ receipt: { receipt_id: 'r-pdf' } }) };
  };
  const Q = { current: { id: 's1', store: "Trader Joe's" } };
  const toast = m => w.toasts.push(m);
  const qDecodeReceipt = async f => { w.decoded.push(f.name); return 'r-img'; };
  const qAttach = async (id, rid) => {
    w.attached.push([id, rid]);
    if (opts.attachFails) throw new Error('this receipt is from 2020, before the hunt began');
    return { receipt_id: rid };
  };
  const closeToScore = async (sess, settle) => { w.closed.push(sess.id); await settle(); };
  const fn = new Function('window', 'document', 'fetch', 'Q', 'toast', 'qDecodeReceipt', 'qAttach',
    'closeToScore', 'api', 'post', 'esc', 'money', 'empty', 'questShow',
    src + '; return HaulUI;');
  const noop = () => '';
  const ui = fn({}, document, fetch, Q, toast, qDecodeReceipt, qAttach, closeToScore,
    noop, noop, noop, noop, noop, noop);
  w.inp = inp; w.status = status; w.ui = ui;
  return w;
}
const pdf = { type: 'application/pdf', name: 'e-receipt.pdf' };
const png = { type: 'image/png', name: 'screenshot.png' };
const upper = { type: '', name: 'RECEIPT.PDF' };

(async () => {
  // A PDF goes to /decode/pdf as a PDF body, then attaches and closes.
  let w = world({});
  w.inp.files = [pdf];
  await w.inp.h({ target: w.inp });
  out.pdf_fetch = w.fetches.length === 1 && w.fetches[0].url === '/decode/pdf'
    && w.fetches[0].init.method === 'POST'
    && w.fetches[0].init.headers['Content-Type'] === 'application/pdf'
    && w.fetches[0].init.body === pdf;
  out.pdf_attached = JSON.stringify(w.attached) === JSON.stringify([['s1', 'r-pdf']]);
  out.pdf_closed = JSON.stringify(w.closed) === JSON.stringify(['s1']);
  out.pdf_no_image_path = w.decoded.length === 0;
  out.pdf_clean = w.toasts.length === 0 && w.status.textContent === '' && w.inp.value === '';

  // A file named .PDF with no type is still a PDF.
  w = world({});
  w.inp.files = [upper];
  await w.inp.h({ target: w.inp });
  out.pdf_by_name = w.fetches.length === 1 && w.fetches[0].url === '/decode/pdf';

  // A screenshot takes the photo decoder; /decode/pdf is not touched.
  w = world({});
  w.inp.files = [png];
  await w.inp.h({ target: w.inp });
  out.img_path = w.fetches.length === 0 && w.decoded[0] === 'screenshot.png'
    && JSON.stringify(w.attached) === JSON.stringify([['s1', 'r-img']]);

  // A decode failure says so, names the cause, and closes nothing.
  w = world({ pdfFails: true });
  w.inp.files = [pdf];
  await w.inp.h({ target: w.inp });
  out.decode_fail = w.toasts.length === 1 && /^Could not read that file: this needs a real account/.test(w.toasts[0])
    && w.closed.length === 0 && w.attached.length === 0 && w.status.textContent === '';

  // An attach refusal is NOT 'could not read': the file was read.
  w = world({ attachFails: true });
  w.inp.files = [pdf];
  await w.inp.h({ target: w.inp });
  out.attach_fail = w.toasts.length === 1 && /^Arya read the file, but could not attach it: /.test(w.toasts[0])
    && !/Could not read/.test(w.toasts[0]) && w.closed.length === 1;

  // No file, no work.
  w = world({});
  w.inp.files = [];
  await w.inp.h({ target: w.inp });
  out.no_file = w.fetches.length === 0 && w.closed.length === 0 && w.toasts.length === 0;

  // The wiring binds once.
  w = world({});
  w.ui.wireFinish();
  out.bind_once = w.inp._hl === true;
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestFinishHandlerUnderNode(unittest.TestCase):
    def test_ereceipt_handler(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(FINISH_DRIVER)
            path = fh.name
        try:
            out = subprocess.run(
                [NODE, path, os.path.join(HERE, "..", "pwa", "haul.js")],
                capture_output=True, text=True, timeout=60)
        finally:
            os.unlink(path)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        bad = [k for k, v in res.items() if v is not True]
        self.assertEqual(bad, [], f"finish handler checks failed: {bad} in {res}")


class TestReviewReopen(unittest.TestCase):
    """Review fixes: the receipt review opens again, a grab with no
    receipt line stays in the haul, and the count-up is silent."""

    def test_review_can_be_reopened_from_score_and_reveal(self):
        js = read("haul.js")
        row = func_body(js, "  function scoreRow")
        self.assertIn('data-hl="review"', row)
        self.assertIn("Check your receipt", row)
        self.assertIn("sess.receipt_id", row)
        self.assertIn("canReview(sess, d)", row)
        self.assertIn('b.dataset.hl === "review"', js)
        self.assertIn("openReview(sess)", js)
        reveal = func_body(js, "  async function openReveal")
        self.assertIn('data-act="review"', reveal)
        self.assertIn("canReview(sess, d)", reveal)
        click = func_body(js, "  function onRevealClick")
        self.assertIn('act === "review"', click)
        can = func_body(js, "  function canReview")
        self.assertIn("d.review.read > 0", can)
        self.assertIn("sess.receipt_id", can)

    def test_reopen_reads_the_live_haul(self):
        js = read("haul.js")
        op = func_body(js, "  async function openReview")
        self.assertIn("data || await fetchHaul(sess)", op)
        self.assertNotIn("H.cache[sess.id] ||", op)

    def test_grabbed_items_stay_unless_the_shopper_removes_them(self):
        js = read("haul.js")
        html = func_body(js, "  function reviewHtml")
        self.assertIn("They stay in your haul.", html)
        self.assertIn("Paid another way? Keep it.", html)
        self.assertIn('"grabbed_only", e,', html)
        self.assertIn('"no")).join("")', html)
        row = func_body(js, "  function reviewRow")
        self.assertIn('chips === "no"', row)

    def test_countup_has_no_live_region(self):
        js = read("haul.js")
        reveal = func_body(js, "  async function openReveal")
        num = reveal[reveal.index('id="rv-pts"'):]
        num = num[:num.index("</p>")]
        self.assertNotIn("aria-live", num)
        self.assertIn('aria-hidden="true"', num)
        # One quiet live node, set once when the count ends.
        self.assertIn('id="rv-pts-sr" role="status" aria-live="polite"', reveal)
        self.assertEqual(js.count("announce(target)"), 2)
        self.assertIn("announce(fin.value)", js)
        step = func_body(js, "  function setNumber")
        self.assertNotIn("rv-pts-sr", step.split("function announce")[0])
        css = read("haul.css")
        self.assertIn(".rv-sr", css)

    def test_raw_receipt_names_make_no_sticker(self):
        js = read("haul.js")
        click = func_body(js, "  async function onReviewClick")
        self.assertIn('send === "extra_add" && window.albumHaul && found.entry.decoded', click)

    def test_share_waits_for_the_haul_view(self):
        js = read("haul.js")
        ready = func_body(js, "  async function shareReady")
        self.assertIn("await fetchHaul(sess)", ready)
        self.assertIn("return null;", ready)
        self.assertIn("return shareCtx(sess)", ready)
        self.assertIn("shareReady", js[js.index("return { afterFinish"):])

    def test_pdf_choice_is_hidden_in_the_demo(self):
        fin = finish_section()
        self.assertIn('class="nomargin real-only"', fin)
        q = read("quest.js")
        self.assertIn('".real-only"', q)
        self.assertIn("e.hidden = qIsDemo()", q)

    def test_hide_and_same_haul_report_the_truth(self):
        js = read("haul.js")
        hide = func_body(js, "  async function toggleHide")
        self.assertIn("d.post.taken_down", hide)
        self.assertIn("Post taken down. Nothing is left to show.", hide)
        same = func_body(js, "  async function onSameSheetClick")
        self.assertIn("HaulCore.sameToast(HaulCore.queuedCount(res.queued, p.post_id), names.length)", same)
        self.assertNotIn("plural(names.length", same)
        sheet = func_body(js, "  async function openSameSheet")
        self.assertIn('api("/api/quest/queued")', sheet)
        self.assertIn("queuedNames", sheet)


if __name__ == "__main__":
    unittest.main()
