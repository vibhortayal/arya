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

    def test_cast_strip_reuses_shipped_portraits(self):
        html = read("index.html")
        self.assertIn('class="caststrip"', html)
        for c in ("milk", "banana", "egg", "blueberry", "pizza", "pantry"):
            self.assertIn(f"assets/characters/{c}.webp", html)

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

    def test_today_band_and_lineup(self):
        html = read("index.html")
        self.assertIn('class="todayband"', html)
        self.assertIn('id="today-lineup"', html)
        a = read("app.js")
        self.assertIn("function paintLineup(items)", a)
        self.assertIn("paintLineup(TODAY_DUE)", a)

    def test_express_wears_no_art(self):
        html = read("index.html")
        express = html.split('id="view-express"')[1].split("</section>")[0]
        self.assertNotIn("assets/characters", express)
        self.assertNotIn("assets/scenes", express)


class TestScoreAndTeachMove(unittest.TestCase):
    def test_score_party_only_when_settled(self):
        q = read("quest.js")
        self.assertIn("assets/scenes/score-party.webp", q)
        self.assertIn('attached ? `<img class="scoreparty"', q)

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
        self.assertEqual(html.count("assets/scenes/storefront.webp"), 2)

    def test_sw_v45_precaches_the_new_art(self):
        sw = read("sw.js")
        self.assertIn('CACHE = "arya-v46"', sw)
        for f in ("assets/scenes/hero.webp", "assets/scenes/score-party.webp",
                  "assets/scenes/storefront.webp",
                  "assets/characters/compass.webp",
                  "assets/characters/basket.webp",
                  "assets/characters/binoculars.webp"):
            self.assertIn(f, sw)


if __name__ == "__main__":
    unittest.main()
