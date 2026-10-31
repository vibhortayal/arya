"""Rewards (owner, 2026-10-28): mobile first, no lives, no game
over, no pressure — dopamine on every grab and after the hunt.
Points mirror the server rule (test_points.py) and only add; the
Quest HUD shows points, not a clock; sound and buzz are opt-in;
reduced motion drops the movement. The behaviour (milestones fire
once as they are crossed, the full haul bursts, a put back never
takes points from the record of grabs, Express stays quiet) runs
under vitest in web/src/screens/hunt/fx.test.ts ("rewards")."""
import unittest

from tests import frontend


def read(name):
    return frontend.read(name)


def src(rel):
    return frontend.src(rel)


def hunt():
    return src("screens/Hunt.tsx")


class TestRewardsShell(unittest.TestCase):
    def test_no_lives_no_clock_on_the_quest_hud(self):
        h = hunt()
        hud = h.split('<div className="hunthud">')[1].split('<div id="q-brief">')[0]
        self.assertIn('id="hunt-timer" ref={timerEl} hidden', hud)
        self.assertIn('id="hunt-pts"', hud)
        tools = h.split('className="hunt-tools"')[1].split('<div id="wild-form"')[0]
        self.assertIn('id="btn-sound"', tools)
        for f in (h, src("screens/hunt/fx.ts"), src("screens/hunt/model.ts")):
            low = f.lower()
            for word in ("game over", "lives left", "lose a life", "you lose", "time's up"):
                self.assertNotIn(word, low)

    def test_haul_banks_with_the_receipt(self):
        score = src("screens/Score.tsx")
        self.assertIn('{attached ? <>Points added<span aria-hidden="true"> ✓</span></> : "Your haul"}', score)
        self.assertIn("That's when your points count.", score)

    def test_reduced_motion_and_theme(self):
        css = read("styles.css")
        tail = css.split("/* Rewards (owner, 2026-10-28)")[1]
        self.assertIn("prefers-reduced-motion: reduce", tail)
        self.assertIn("motionOff()", src("screens/hunt/fx.ts"))
        self.assertIn('matchMedia("(prefers-reduced-motion: reduce)")', src("lib/motion.ts"))

    def test_level_shows_on_the_quest_tab_and_progress(self):
        # The level chip moved from Today to the Quest tab (list-first
        # pass, 2026-10-29).
        quest = src("screens/Quest.tsx")
        self.assertIn('get("/api/quest/profile").then(p => {', quest)  # avatar ring
        # Your trips keeps only the avatar ring; the level shows in Quest
        # and Quest progress (usability audit).
        self.assertNotIn('id="today-level"', quest)
        self.assertIn("Level · {{points}} points", src("screens/QuestProgress.tsx"))


class TestRewardsUnderVitest(unittest.TestCase):
    def test_rewards_behavior(self):
        t = src("screens/hunt/fx.test.ts")
        for name in ("milestones in order, one full-haul burst, points follow a put back",
                     "three quick grabs stay quiet; Express never celebrates; sound starts off"):
            self.assertIn(name, t)


class TestFindItForMe(unittest.TestCase):
    def test_button_on_the_next_card_aims_the_scan(self):
        h = hunt()
        pop = h.split('id="hunt-pop"')[1].split('id="hunt-done-note"')[0]
        self.assertIn('id="btn-findit"', pop)
        self.assertIn("Find it for me", pop)
        self.assertIn("openScan(s.items[i].name)", pop)
        self.assertIn("Q.scanTarget = target;", h)
        scan = src("screens/hunt/Scan.tsx")
        self.assertIn("const aim = t ? `&item=${encodeURIComponent(t)}` : \"\";", scan)
        self.assertIn("Found it! {{name}} is highlighted", scan)

    def test_fresh_photo_on_the_card_and_the_privacy_line(self):
        h = hunt()
        pop = h.split('id="hunt-pop"')[1].split('id="hunt-done-note"')[0]
        self.assertIn('id="hunt-fresh"', pop)
        self.assertIn("People are blurred out; Arya keeps only products.", src("screens/hunt/Scan.tsx"))
        self.assertIn("/api/quest/shelf-photo?store=", h)
        self.assertIn("People are blurred out; we only keep products.", h)


class TestPlanAHunt(unittest.TestCase):
    """Owner, 2026-10-28: pick the store first, then move items from
    the Arya list into the quest; planning is the same list."""

    def test_store_first_then_items(self):
        quest = src("screens/Quest.tsx")
        # Quest mode (#158): a new trip starts in the game, which picks
        # the store first; Your trips has no New quest (usability audit).
        self.assertNotIn('id="btn-new-hunt"', quest)
        self.assertIn('<div id="nl-plan">', src("screens/NewList.tsx"))
        self.assertNotIn("Choose items", src("screens/NewList.tsx"))

    def test_buckets_and_list_management(self):
        nl = src("screens/NewList.tsx")
        for label in ("Usually bought here", "New on your list", "Usually from {{store}}"):
            self.assertIn(label, nl)
        rm = nl.split("const removeFromList = async")[1].split("\n  };")[0]
        self.assertIn('post("/api/list/remove", { item_id: itemId })', rm)
        self.assertIn('action: "Undo"', rm)
        self.assertIn('post("/api/list/add", { item_id: itemId })', rm)
        self.assertIn("data-planrm={key}", nl)
        start = nl.split("const start = async () => {")[1].split("\n  };")[0]
        self.assertIn('post("/api/list/add", { ...body, ...lid })', start)

    def test_clean_list_skips_check_my_list(self):
        nl = src("screens/NewList.tsx")
        opt = nl.split("async function optimize(replace: boolean) {")[1].split("\n  }")[0]
        self.assertIn("!rep.merged.length && !rep.corrected.length && !rep.questions.length", opt)
        self.assertIn('go("mode", { draft: D });', opt)


if __name__ == "__main__":
    unittest.main()
