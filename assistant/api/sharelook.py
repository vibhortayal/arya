"""Share looks (owner, 2026-10-28): an optional paint pass for the haul
card. The phone draws the card's art layer (cream ground and the cast
stickers, no text, no photo) and Muse Image paints it in one of three
looks: the shopper's new badge, a cast character joining in, or a
hand-painted storybook scene. The phone adds the words afterwards, so
names and numbers never pass through the image model.

The prompts are fixed text keyed by the look. Nothing the player typed
and no name reaches the model. The upload lives in this call's memory
only and the result is returned, never stored. One tap is one image
($0.01); Try another is the next tap.
"""

LOOKS = ("badge", "friends", "story")
MAX_BYTES = 4_000_000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_KEEP = ("Keep every sticker and character in exactly the same place and "
         "size. Keep the top and bottom of the picture calm and plain so "
         "words can be added there later. Do not add any text, letters, "
         "numbers, logos or people.")

PROMPTS = {
    "story": ("Repaint this picture as a soft hand-painted storybook "
              "illustration: gentle watercolour texture, warm light, a cosy "
              "kitchen-garden feel. " + _KEEP),
    "badge": ("The round medal in the top right is a reward badge. Redraw it "
              "as a shiny enamel medal with a small ribbon, and paint the "
              "rest in a soft storybook style. " + _KEEP),
    "friends": ("The large characters in the lower right are friends joining "
                "the scene. Give them playful poses, one waving and one "
                "peeking over the stickers, and paint the rest in a soft "
                "storybook style. " + _KEEP),
}


def make(look, card_png, client):
    """Return (webp_bytes, cost_usd) for one painted art layer."""
    if look not in LOOKS:
        raise ValueError("unknown look")
    if not card_png or len(card_png) > MAX_BYTES:
        raise ValueError("send the card art as a PNG under 4 MB")
    if not card_png.startswith(PNG_MAGIC):
        raise ValueError("send the card art as a PNG")
    img, _, cost = client.edit_image(card_png, PROMPTS[look], "image/png")
    return img, cost
