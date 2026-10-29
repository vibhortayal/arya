"""gen_quest_scenes — generate the Quest section scenes (the view down
each kind of aisle) with Muse Image through api/meta_client.py.

One style for all, matching the character art: flat vector game
background, soft warm colours, one-point perspective with the middle
of the aisle left clear (the item card sits there). No people, no
text, no logos. These are illustrations of a typical store; they never
claim to picture a real one, and a simulated store shows them tinted
as a blueprint.

Runs on the VM with the owner's MODEL_API_KEY (no transport argument).
Existing files are skipped (resume-safe).

Run from assistant/:  ../.venv/bin/python tools/gen_quest_scenes.py
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api.meta_client import MetaClient, IMAGE_USD_PER_IMAGE  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets", "quest")
CAP_USD = 0.25  # 12 images at $0.01, with headroom for retries

STYLE = ("Game background illustration: {scene}. Seen from a shopper's "
         "eye height, one-point perspective with the vanishing point in "
         "the centre, the middle of the aisle open and uncluttered. Warm "
         "ceiling lights, clean light floor tiles, cozy and inviting. Flat "
         "vector illustration, soft colours, gentle shading, light cream "
         "tones, matching cute mascot game art. No people, no text, no "
         "words, no letters, no numbers, no signs with writing, no logos, "
         "no brand names")

SCENES = {
    "produce": "a grocery store produce section, wooden crates and slanted bins of colourful apples, oranges, bananas, leafy greens, tomatoes and peppers on both sides, a light mist over the greens",
    "bakery": "a grocery store bakery corner, warm wooden shelves of golden loaves, baguettes, croissants and muffins on both sides, glass display case, warm light",
    "deli": "a grocery store deli and dips counter, refrigerated glass cases with tubs of hummus, salsas, olives and cheeses on both sides",
    "meat": "a grocery store meat and fish counter, clean refrigerated cases with neatly wrapped cuts, fish on crushed ice on both sides",
    "dairy": "a grocery store dairy aisle, tall glass-door coolers glowing softly on both sides, filled with milk cartons, eggs, yogurt and cheese",
    "frozen": "a grocery store frozen food aisle, frosted glass freezer doors on both sides glowing icy blue, ice cream tubs, frozen pizzas and vegetables inside, a little frost on the glass",
    "aisle1": "a grocery store snacks and drinks aisle, tall shelves on both sides stacked with colourful chip bags, crackers, cookies and bottled drinks",
    "aisle2": "a grocery store pasta and oils aisle, tall shelves on both sides with boxes and bags of pasta, jars of sauce, bottles of olive oil and cans",
    "aisle3": "a grocery store breakfast aisle, tall shelves on both sides with cereal boxes, oats, jars of jam, honey, peanut butter and coffee",
    "aisle4": "a grocery store household aisle, tall shelves on both sides with paper towels, detergent bottles, sponges and soap",
    "checkout": "a cheerful grocery store checkout lane, a conveyor belt with a full paper grocery bag and fruit, the exit doors bright beyond",
    "entrance": "the entrance of a friendly neighbourhood grocery store from inside, stacked shopping baskets and carts, produce displays ahead",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    client = MetaClient()
    spent, made, skipped = 0.0, [], []
    for name, scene in SCENES.items():
        path = os.path.join(OUT, f"{name}.webp")
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            skipped.append(name)
            continue
        if spent + IMAGE_USD_PER_IMAGE > CAP_USD:
            raise RuntimeError(f"spend cap ${CAP_USD:.2f} reached at ${spent:.2f}")
        img, usage, cost = client.generate_image(STYLE.format(scene=scene))
        if not (img[:4] == b"RIFF" and img[8:12] == b"WEBP"):
            raise RuntimeError(f"{name}: unexpected image bytes {img[:12]!r}")
        with open(path, "wb") as fh:
            fh.write(img)
        spent += cost
        made.append(name)
        print(f"{name}: {len(img)} bytes, cost=${cost:.4f}")
    print(f"done: {len(made)} generated, {len(skipped)} skipped, total spend ${spent:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
