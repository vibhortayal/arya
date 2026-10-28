"""gen_characters — generate the collect-celebration characters
(Discussion 32) with Muse Image through api/meta_client.py.

One style for all: cute flat mascot, big friendly eyes, simple
shapes, soft colors, plain light background, no text in the image.
Characters are game art only — they never picture a real store.

Transport mirrors tools/build_shelf_graph.py: on this host the
Meta key is a connector surrogate placed by dynamic_credentials;
on the VM the same client runs on the owner's MODEL_API_KEY with
no transport argument. Existing files are skipped (resume-safe).

Run from assistant/:  ../.venv/bin/python tools/gen_characters.py
"""
import json, os, sys, urllib.error, urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from api.meta_client import MetaClient, IMAGE_USD_PER_IMAGE  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets", "characters")
CAP_USD = 0.30  # 20 images at $0.01, with headroom for one retry round

STYLE = ("Cute flat mascot character of {subject}: big friendly eyes, "
         "a small happy smile, two tiny arms, simple bold shapes, soft "
         "colors, flat vector style, plain very light cream background, "
         "centered, full body, no text, no words, no letters")

SUBJECTS = {
    # exact items (manifest.json)
    "blueberry": "a blueberry, one round blue berry with a tiny crown on top",
    "banana": "a banana, one curved yellow banana",
    "raspberry": "a raspberry, a cluster of small pink-red drupelets with a green leaf",
    "mandarin": "a mandarin orange, a round orange citrus fruit with a green leaf",
    "egg": "an egg, one smooth white egg",
    "cheese": "a wedge of Swiss cheese, a yellow triangular wedge with round holes",
    "bread": "a loaf of bread, a golden brown loaf with slashes on top",
    "pasta": "a bowl of pasta, swirled spaghetti in a simple bowl with a fork",
    "pizza": "a slice of pizza, a triangular slice with melted cheese and pepperoni",
    "hummus": "a bowl of hummus, a small bowl of creamy beige dip with a swirl and one olive on top",
    "olive-oil": "a bottle of olive oil, a green glass bottle with olives and a leaf beside it",
    "peanut-butter": "a jar of peanut butter, a glass jar of smooth peanut butter with peanuts beside it",
    "almond": "an almond, one brown teardrop-shaped almond nut",
    "milk": "a carton of milk, a white and light-blue milk carton",
    # category fallbacks
    "fruit": "a fruit basket, a small basket holding an apple, grapes and an orange",
    "vegetable": "a basket of vegetables, a carrot, a tomato and leafy greens in a small basket",
    "dairy": "a dairy pair, a glass bottle of milk next to a small dish of butter",
    "bakery": "a croissant, one golden flaky croissant",
    "frozen": "an ice cream cone, a cone with two scoops, pink and white",
    "pantry": "a pantry jar, a clear glass jar filled with rice beside a small sack of flour",
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def surrogate_transport(method, url, headers, body):
    """MetaClient transport over the connector surrogate flow (the
    Authorization header from _send is dropped; the surrogate adds
    the credential for api.meta.ai only)."""
    from dynamic_credentials import add_surrogate_to_request, \
        read_json_response
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method=method)
    add_surrogate_to_request(req, "custom.meta-model-api",
                             allowed_hosts=["api.meta.ai"])
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(req, timeout=180) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        try:
            payload = read_json_response(e)
        except Exception:
            payload = {"raw_error": str(e)}
        return e.code, payload


def main():
    os.makedirs(OUT, exist_ok=True)
    client = MetaClient(transport=surrogate_transport)
    spent, made, skipped = 0.0, [], []
    for name, subject in SUBJECTS.items():
        path = os.path.join(OUT, f"{name}.webp")
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            skipped.append(name)
            continue
        if spent + IMAGE_USD_PER_IMAGE > CAP_USD:
            raise RuntimeError(f"spend cap ${CAP_USD:.2f} reached at ${spent:.2f}")
        img, usage, cost = client.generate_image(STYLE.format(subject=subject))
        if not (img[:4] == b"RIFF" and img[8:12] == b"WEBP"):
            raise RuntimeError(f"{name}: unexpected image bytes {img[:12]!r}")
        with open(path, "wb") as fh:
            fh.write(img)
        spent += cost
        made.append(name)
        print(f"{name}: {len(img)} bytes, usage={usage}, cost=${cost:.4f}")
    print(f"done: {len(made)} generated, {len(skipped)} skipped, "
          f"total spend ${spent:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
