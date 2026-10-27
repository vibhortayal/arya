"""Eyes — visual inventory (Stage 4, EYES.md).
Rule D (IMPLEMENTATION 1.1): a sighting from a single photo needs two
independent reads to agree; a disagreement is marked and the user decides.
Unseen items stay unknown — a photo never removes an item by absence.
Corrections apply only on the user's confirmation (no silent edits)."""
import base64, json, os, re

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "eyes_v1.md")

# Shelf-life priors in days, by keyword in the item name (EYES.md expiry v1).
PRIORS = [("spinach", 5), ("lettuce", 5), ("salad", 5), ("berries", 5),
          ("strawberr", 5), ("bread", 6), ("milk", 9), ("yogurt", 14),
          ("egg", 21), ("chicken", 4), ("beef", 4), ("pork", 4), ("fish", 3)]


def prior_days(name):
    n = (name or "").lower()
    for key, days in PRIORS:
        if key in n:
            return days
    return None


def _tokens(name):
    return {t for t in re.split(r"[^a-z0-9]+", (name or "").lower()) if len(t) > 2}


def _same(a, b):
    ta, tb = _tokens(a), _tokens(b)
    return bool(ta & tb) and (ta <= tb or tb <= ta or len(ta & tb) >= min(len(ta), len(tb)) - 0)


def _read(image_bytes, client, media_type):
    data_uri = f"data:{media_type};base64," + base64.b64encode(image_bytes).decode()
    system = open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": [
                    {"type": "text", "text": "List the items you can see in this photo."},
                    {"type": "image_url", "image_url": {"url": data_uri}}]}]
    out, _u, _c = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    return dec.get("sightings", [])


def detect(image_bytes, client, media_type="image/jpeg"):
    """Two reads; merge with Rule D agreement flags."""
    first = _read(image_bytes, client, media_type)
    second = _read(image_bytes, client, media_type)
    merged = []
    used = set()
    for s in first:
        partner = next((i for i, t in enumerate(second)
                        if i not in used and _same(s.get("name", ""), t.get("name", ""))), None)
        if partner is not None:
            used.add(partner)
            merged.append({"name": s["name"],
                           "confidence": min(s.get("confidence", 0), second[partner].get("confidence", 0)),
                           "judge_agree": True})
        else:
            merged.append({"name": s["name"], "confidence": s.get("confidence", 0),
                           "judge_agree": False})
    for i, t in enumerate(second):
        if i not in used:
            merged.append({"name": t["name"], "confidence": t.get("confidence", 0),
                           "judge_agree": False})
    return merged


def match_item(name, name_index):
    """name_index: item_id -> list of known names. Token-overlap best match."""
    target = _tokens(name)
    best, best_score = None, 0
    for item_id, known_names in name_index.items():
        for known in known_names:
            kt = _tokens(known)
            if not kt:
                continue
            score = len(target & kt) / max(len(target | kt), 1)
            if target and (target <= kt or kt <= target):
                score = max(score, 0.5)  # "Milk" inside "Whole Milk 1 gal" is a match
            if score > best_score:
                best, best_score = item_id, score
    return best if best_score >= 0.34 else None
