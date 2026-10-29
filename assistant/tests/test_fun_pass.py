"""Fun pass (owner, 2026-10-28): the cast is the game, and the
teach ask moves to the briefing + the hunt.

Pins: the landing cards wear shipped character portraits;
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

from tests import frontend

PWA = pathlib.Path(frontend.STATIC)


def read(name):
    return frontend.read(name)


src = frontend.src


class TestLanding(unittest.TestCase):
    def test_landing_cards_wear_shipped_characters(self):
        # B1 flip cards (owner, 2026-10-29): each card wears a shipped
        # character portrait; no walk frame, no cast strip.
        login = src("screens/Login.tsx")
        self.assertNotIn("models/trader-joes/frames-web", login)
        self.assertNotIn("caststrip", login)
        self.assertIn("src={asset(`assets/characters/${c.face}.webp`)}", login)
        for c in ("milk", "egg", "compass", "binoculars"):
            self.assertIn(f'face: "{c}"', login)
            self.assertTrue((PWA / "assets" / "characters" / f"{c}.webp").exists(), c)

    def test_scene_assets_exist(self):
        for f in ("hero.webp", "score-party.webp", "storefront.webp"):
            self.assertTrue((PWA / "assets" / "scenes" / f).exists(), f)
        for f in ("compass.webp", "basket.webp", "binoculars.webp"):
            self.assertTrue((PWA / "assets" / "characters" / f).exists(), f)


class TestFaces(unittest.TestCase):
    def test_ladder_lives_in_both_resolvers(self):
        # One resolver now (lib/characters.ts) for every screen: exact
        # item, then category, then the manifest's fallback; faceFor
        # adds the basket when even that is missing.
        c = src("lib/characters.ts")
        self.assertIn("export function charFor(name: unknown)", c)
        self.assertIn("return CHARM.fallback || null;", c)
        self.assertIn('export const faceFor = (name: unknown): string => charFor(name) || "basket.webp";', c)

    def test_registry_names_its_fallback_and_roles(self):
        m = json.loads(read("assets/characters/manifest.json"))
        self.assertEqual(m["fallback"], "basket.webp")
        self.assertEqual(m["roles"]["compass"], "compass.webp")
        self.assertEqual(m["roles"]["binoculars"], "binoculars.webp")

    def test_hunt_rows_and_target_card_wear_faces(self):
        q = src("screens/Hunt.tsx")
        self.assertIn('className="rowface"', q)
        self.assertIn('className="popface"', q)
        self.assertIn('asset("assets/characters/" + faceFor(it.name))', q)

    def test_quest_band_and_today_faces(self):
        # The band moved to the Quest tab; Today's running-low rows wear
        # the characters (list-first pass, owner 2026-10-29).
        self.assertIn('className="todayband"', src("screens/Quest.tsx"))
        today = src("screens/Today.tsx")
        self.assertIn("const c = charFor(name);", today)
        self.assertIn("<Face name={i.name} />", today)
        # Faces arrive late: the hook repaints Today once the manifest loads.
        self.assertIn("useCharacters();", today)

    def test_express_wears_no_art(self):
        express = src("screens/Express.tsx")
        self.assertNotIn("assets/characters", express)
        self.assertNotIn("assets/scenes", express)


class TestScoreAndTeachMove(unittest.TestCase):
    def test_score_party_only_when_settled(self):
        q = src("screens/Score.tsx")
        self.assertIn('{attached && !plain && <img className="scoreparty" src={asset("assets/scenes/score-party.webp")}', q)

    def test_teach_ask_left_the_score_screen(self):
        self.assertNotIn("mapperOfferAfterHunt", frontend.app())
        self.assertNotIn("mapper", src("screens/Score.tsx").lower())

    def test_briefing_card_and_hunt_icon(self):
        h = src("screens/Hunt.tsx")
        # never before the first hunt, never in Express, mute shared
        brief = h.split("/* The briefing card (before the start) and the Teach Arya tool. */")[1].split("  useEffect(")[1]
        self.assertIn('sess.mode === "express" || mapperMuted(store)', brief)
        self.assertIn('localStorage.getItem("arya-hunted")', brief)
        self.assertIn('id="q-brief"', h)
        self.assertIn('id="btn-teach"', h)
        self.assertIn('asset("assets/characters/compass.webp")', h)

    def test_score_marks_the_player_as_hunted(self):
        self.assertIn('localStorage.setItem("arya-hunted", "1")', src("screens/Score.tsx"))


class TestBadgesAndEmptyStates(unittest.TestCase):
    def test_badge_art_map(self):
        a = src("screens/QuestProgress.tsx")
        self.assertIn("const BADGE_ART", a)
        for bid, char in (("egg_baron", "egg.webp"),
                          ("banana_republic", "banana.webp"),
                          ("clean_sweep", "basket.webp"),
                          ("first_mapper", "compass.webp"),
                          ("eagle_eye", "binoculars.webp")):
            self.assertIn(f'{bid}: "{char}"', a)
        self.assertIn('className="bdgimg"', a)

    def test_empty_list_wears_the_pantry(self):
        lists = src("screens/Lists.tsx")
        self.assertIn("emptyface", lists)
        self.assertIn("/assets/characters/pantry.webp", lists)

    def test_teach_row_and_mapper_wear_the_storefront(self):
        # Teach row (Quest), mapper, Today's quiet Quest row, and the
        # Quest choice on a list's Start shopping sheet.
        for f in ("screens/Quest.tsx", "screens/Mapper.tsx", "screens/Today.tsx", "screens/Lists.tsx"):
            self.assertEqual(src(f).count("assets/scenes/storefront.webp"), 1, f)

    def test_sw_v45_precaches_the_new_art(self):
        sw = src("sw.js")
        for f in ("/assets/scenes/hero.webp", "/assets/scenes/score-party.webp",
                  "/assets/scenes/storefront.webp"):
            self.assertIn(f, sw)
        for c in ("compass", "basket", "binoculars"):
            self.assertIn(f'"{c}"', sw)

if __name__ == "__main__":
    unittest.main()


class TestPlanComposer(unittest.TestCase):
    """The plan screen's add box (owner, 2026-10-28): raised above
    the plan rows, shorter, and fed by voice and photo as well as
    text — the same doors as the List composer."""

    def test_composer_sits_above_the_plan_rows(self):
        nl = src("screens/NewList.tsx")
        self.assertLess(nl.index('id="nl-text"'), nl.index('id="nl-plan"'))

    def test_shorter_box_with_mic_and_photo(self):
        nl = src("screens/NewList.tsx")
        self.assertIn('id="nl-text" rows={2}', nl)
        self.assertIn('id="nl-mic"', nl)
        self.assertIn('id="nl-photo"', nl)
        self.assertIn('id="nl-status"', nl)

    def test_voice_and_photo_feed_the_quest(self):
        q = src("screens/NewList.tsx")
        self.assertIn('id="nl-mic" type="button" onClick={mic}', q)
        self.assertIn('"/api/list/from-photo"', q)
        # photo items are ticked into this quest, not just the list
        self.assertIn("D.pick[key] = { name: n, qty: (D.pick[key] || {}).qty || 1, on: true };", q)
        # a receipt photo is never filed mid-plan
        self.assertIn("That looks like a receipt. Add it from Settings › Receipts.", q)


class TestQuietMilestones(unittest.TestCase):
    """The milestone banner (owner, 2026-10-28): off the photo,
    tucked under the scene, two moments only, soft pill styling."""

    def test_slot_sits_under_the_scene_in_flow(self):
        h = src("screens/Hunt.tsx")
        self.assertLess(h.index('id="scene-cap"'), h.index('id="milestone"'))
        self.assertLess(h.index('id="milestone"'), h.index('className="hunt-tools"'))
        self.assertIn('<div id="milestone" className="milestone" role="status" />', h)

    def test_two_moments_only(self):
        q = src("screens/hunt/fx.ts")
        self.assertIn('[[0.5, "Halfway there!"]]', q)
        self.assertIn('"One to go!"', q)
        for gone in ("A quarter of the way!", "Three quarters", "Hot streak"):
            self.assertNotIn(gone, frontend.app())

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
        self.assertIn('"art"', src("screens/Hunt.tsx"))
        api = open(os.path.join(os.path.dirname(__file__), "..",
                                "api", "quest.py"), encoding="utf-8").read()
        self.assertIn('"art"', api.split("DRIVERS =")[1].split("\n")[0])

    def test_art_asset_ships_and_precaches(self):
        self.assertTrue(os.path.exists(os.path.join(frontend.STATIC, "assets", "scenes", "aisle-art.webp")))
        self.assertIn("/assets/scenes/aisle-art.webp", src("sw.js"))

    def test_resolution_and_caption_carry_the_nudge(self):
        q = src("screens/Hunt.tsx")
        self.assertIn('base === "photo" && focus && focus.unplaced ? "art" : base', q)
        self.assertIn("Tap Map this store to help.", q)
        # Express never gets the art rung
        self.assertIn('return sess.mode === "express" ? "strip" : "art";', q)

    def test_demo_picker_shows_every_store(self):
        # No store ships with pictures (2026-10-29): hiding dataless
        # stores from the demo would leave it nothing to pick.
        q = src("screens/Store.tsx")
        self.assertNotIn("!demo || storeHasPictures", q)
        self.assertNotIn("mine.filter(s => storeHasPictures", q)
