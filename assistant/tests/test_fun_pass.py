"""Fun pass (owner, 2026-10-28): the cast is the game, and the
teach ask moves to the briefing + the hunt.

Pins: the landing wears generated key art (not a raw walk frame);
the cast strip reuses shipped portraits; Today carries the scene
band and the due lineup; hunt rows and the suggested-next card wear
faces resolved by the ladder (exact -> category -> basket); the
Score screen celebrates settled hunts with the party art and no
longer carries the teach ask; the teach ask lives on the briefing
(never before a first hunt) and as a passive in-hunt tool; badges
wear characters; the registry names its fallback.
"""
import json
import os
import pathlib
import unittest

PWA = pathlib.Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text(encoding="utf-8")


class TestLanding(unittest.TestCase):
    def test_hero_is_cast_key_art_not_a_walk_frame(self):
        html = read("index.html")
        self.assertIn('src="assets/scenes/hero.webp"', html)
        self.assertNotIn('class="heroimg" src="models/trader-joes/frames-web', html)

    def test_landing_shows_rows_not_the_cast_strip(self):
        # List first (owner, 2026-10-29): the landing shows three real
        # kinds of row; the cast strip left with the treasure-hunt pitch.
        html = read("index.html")
        login = html.split('id="view-login"')[1].split('id="signin-sheet"')[0]
        self.assertNotIn('class="caststrip"', login)
        for c in ("milk", "egg", "vegetable"):
            self.assertIn(f"assets/characters/{c}.webp", login)

    def test_scene_assets_exist(self):
        for f in ("hero.webp", "score-party.webp", "storefront.webp"):
            self.assertTrue((PWA / "assets" / "scenes" / f).exists(), f)
        for f in ("compass.webp", "basket.webp", "binoculars.webp"):
            self.assertTrue((PWA / "assets" / "characters" / f).exists(), f)


class TestFaces(unittest.TestCase):
    def test_ladder_lives_in_both_resolvers(self):
        for src in ("quest.js", "app.js"):
            self.assertIn("fallback", read(src), src)
        q = read("quest.js")
        self.assertIn("function qFaceFor(name)", q)
        self.assertIn('CELEB.fallback', q)
        self.assertIn("function charFor(name)", read("app.js"))

    def test_registry_names_its_fallback_and_roles(self):
        m = json.loads(read("assets/characters/manifest.json"))
        self.assertEqual(m["fallback"], "basket.webp")
        self.assertEqual(m["roles"]["compass"], "compass.webp")
        self.assertEqual(m["roles"]["binoculars"], "binoculars.webp")

    def test_hunt_rows_and_target_card_wear_faces(self):
        q = read("quest.js")
        self.assertIn('class="rowface"', q)
        self.assertIn('class="popface"', q)
        self.assertIn("qFaceFor(it.name)", q)

    def test_quest_band_and_today_faces(self):
        # The band moved to the Quest tab; Today's running-low rows wear
        # the characters (list-first pass, owner 2026-10-29).
        html = read("index.html")
        quest = html.split('id="view-community"')[1].split("</section>")[0]
        self.assertIn('class="todayband"', quest)
        a = read("app.js")
        low = a.split("function paintTodayLow(h)")[1].split("\n}\n")[0]
        self.assertIn("charFor(i.name)", low)
        self.assertIn("if (TODAY_HOME) paintTodayLow(TODAY_HOME)", a)

    def test_express_wears_no_art(self):
        html = read("index.html")
        express = html.split('id="view-express"')[1].split("</section>")[0]
        self.assertNotIn("assets/characters", express)
        self.assertNotIn("assets/scenes", express)


class TestScoreAndTeachMove(unittest.TestCase):
    def test_score_party_only_when_settled(self):
        q = read("quest.js")
        self.assertIn("assets/scenes/score-party.webp", q)
        self.assertIn('attached && !plain ? `<img class="scoreparty"', q)

    def test_teach_ask_left_the_score_screen(self):
        self.assertNotIn("mapperOfferAfterHunt", read("quest.js"))
        self.assertNotIn("mapperOfferAfterHunt", read("mapper.js"))

    def test_briefing_card_and_hunt_icon(self):
        m = read("mapper.js")
        self.assertIn("function mapperOfferBriefing(sess)", m)
        self.assertIn("function mapperHuntIcon(sess)", m)
        # never before the first hunt, never in Express, mute shared
        self.assertIn('localStorage.getItem("arya-hunted")', m)
        self.assertIn('sess.mode === "express"', m)
        html = read("index.html")
        self.assertIn('id="q-brief"', html)
        self.assertIn('id="btn-teach"', html)
        self.assertIn("assets/characters/compass.webp", html)

    def test_score_marks_the_player_as_hunted(self):
        self.assertIn('localStorage.setItem("arya-hunted", "1")',
                      read("quest.js"))


class TestBadgesAndEmptyStates(unittest.TestCase):
    def test_badge_art_map(self):
        a = read("app.js")
        self.assertIn("const BADGE_ART", a)
        for bid, char in (("egg_baron", "egg.webp"),
                          ("banana_republic", "banana.webp"),
                          ("clean_sweep", "basket.webp"),
                          ("first_mapper", "compass.webp"),
                          ("eagle_eye", "binoculars.webp")):
            self.assertIn(f'{bid}: "{char}"', a)
        self.assertIn('class="bdgimg"', a)

    def test_empty_list_wears_the_pantry(self):
        self.assertIn("emptyface", read("app.js"))
        self.assertIn("assets/characters/pantry.webp", read("app.js"))

    def test_teach_row_and_mapper_wear_the_storefront(self):
        html = read("index.html")
        # Teach row (Quest), mapper, and Today's quiet Quest row.
        self.assertEqual(html.count("assets/scenes/storefront.webp"), 3)

    def test_sw_v45_precaches_the_new_art(self):
        sw = read("sw.js")
        self.assertIn('CACHE = "arya-v83"', sw)
        for f in ("assets/scenes/hero.webp", "assets/scenes/score-party.webp",
                  "assets/scenes/storefront.webp",
                  "assets/characters/compass.webp",
                  "assets/characters/basket.webp",
                  "assets/characters/binoculars.webp"):
            self.assertIn(f, sw)


if __name__ == "__main__":
    unittest.main()


class TestPlanComposer(unittest.TestCase):
    """The plan screen's add box (owner, 2026-10-28): raised above
    the plan rows, shorter, and fed by voice and photo as well as
    text — the same doors as the List composer."""

    def test_composer_sits_above_the_plan_rows(self):
        html = read("index.html")
        self.assertLess(html.index('id="nl-text"'), html.index('id="nl-plan"'))

    def test_shorter_box_with_mic_and_photo(self):
        html = read("index.html")
        self.assertIn('id="nl-text" rows="2"', html)
        self.assertIn('id="nl-mic"', html)
        self.assertIn('id="nl-photo"', html)
        self.assertIn('id="nl-status"', html)

    def test_voice_and_photo_feed_the_quest(self):
        q = read("quest.js")
        self.assertIn('wireRecordButton($("#nl-mic")', q)
        self.assertIn('"/api/list/from-photo"', q)
        # photo items are ticked into this quest, not just the list
        self.assertIn("Q.draft.pick[key]", q)
        # a receipt photo is never filed mid-plan
        self.assertIn("file it from the List tab", q)


class TestQuietMilestones(unittest.TestCase):
    """The milestone banner (owner, 2026-10-28): off the photo,
    tucked under the scene, two moments only, soft pill styling."""

    def test_slot_sits_under_the_scene_in_flow(self):
        html = read("index.html")
        self.assertLess(html.index('id="scene-cap"'), html.index('id="milestone"'))
        self.assertLess(html.index('id="milestone"'), html.index('class="hunt-tools"'))
        self.assertNotIn('id="milestone" class="milestone" role="status" hidden', html)

    def test_two_moments_only(self):
        q = read("quest.js")
        self.assertIn('[[0.5, "Halfway there!"]]', q)
        self.assertIn('"One to go!"', q)
        for gone in ("A quarter of the way!", "Three quarters", "Hot streak"):
            self.assertNotIn(gone, q)

    def test_soft_pill_not_a_black_banner(self):
        css = read("styles.css")
        block = css.split(".milestone {")[1].split("}")[0]
        self.assertIn("var(--acc-soft)", block)
        self.assertNotIn("position: fixed", block)
        self.assertNotIn("var(--ink)", block)


class TestArtScene(unittest.TestCase):
    """The art rung + the demo store filter (owner, 2026-10-28):
    an unmapped store or section in Quest mode plays on the
    illustrated aisle, and the demo never offers a data-less
    store."""

    def test_art_driver_registered_and_honest(self):
        s = read("scene.js")
        self.assertIn("SceneDrivers.art = function", s)
        self.assertIn("assets/scenes/aisle-art.webp", s)
        self.assertIn('"art"', read("quest.js"))
        api = open(os.path.join(os.path.dirname(__file__), "..",
                                "api", "quest.py"), encoding="utf-8").read()
        self.assertIn('"art"', api.split("DRIVERS =")[1].split("\n")[0])

    def test_art_asset_ships_and_precaches(self):
        here = os.path.dirname(__file__)
        self.assertTrue(os.path.exists(os.path.join(
            here, "..", "pwa", "assets", "scenes", "aisle-art.webp")))
        self.assertIn("/assets/scenes/aisle-art.webp", read("sw.js"))

    def test_resolution_and_caption_carry_the_nudge(self):
        q = read("quest.js")
        self.assertIn('base === "photo" && focus && focus.unplaced ? "art" : base', q)
        self.assertIn("Tap Teach Arya to map it for real", q)
        # Express never gets the art rung
        self.assertIn('Q.current.mode === "express" ? "strip" : "art"', q)

    def test_demo_picker_hides_dataless_stores(self):
        q = read("quest.js")
        self.assertIn("!qIsDemo() || qStorePhotos(h) || qStoreModel(h)", q)
