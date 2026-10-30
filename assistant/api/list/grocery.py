"""Is this a grocery item? — one answer for every entry path.

Order, cheapest first (owner-approved hybrid, 2026-10-29):
 1. A saved verdict for the name (the user's own word, or an earlier
    model judgement) — $0.
 2. Non-grocery phrase rules (gift cards, fuel, golf, clothing,
    electronics, ...) — $0.
 3. The aisle map in aisles.py (a hit means groceries or household
    goods) — $0.
 4. Otherwise "unknown". Unknown is treated as groceries everywhere;
    only judge_unknown() (one batched Spark Standard call, run by the
    caller, verdicts cached per name) may turn it into "other".

Nothing here ever blocks an item. A caller shows "Not a grocery item?
Added anyway" for kind "other"; the user's Keep is saved as a verdict
that beats every rule. classify() is pure and never calls a model.
"""
import json
import re

from api import aisles
from api.list.intake import _key

# kind -> phrases. A phrase of 2+ words or a STRONG word beats an aisle
# hit ("apple iphone" is electronics); a weak one-word phrase only
# counts when the aisle map knows nothing ("tv dinner" stays food).
OTHER_RULES = {
    "gift cards": ["gift card", "giftcard", "gift certificate", "egift",
                   "e gift", "store credit", "prepaid card"],
    "fuel": ["gas", "gasoline", "fuel", "diesel", "petrol", "gas station",
             "fill up", "propane", "car wash"],
    "pharmacy": ["prescription", "rx", "pharmacy", "copay", "co pay",
                 "vaccine", "flu shot"],
    "clothing": ["shirt", "t shirt", "tee", "jeans", "pants", "socks",
                 "sock", "jacket", "coat", "shoes", "sneakers", "dress",
                 "hoodie", "sweater", "underwear", "bra", "hat", "gloves",
                 "scarf", "pajamas", "shorts", "boots", "sandals"],
    "electronics": ["iphone", "ipad", "airpods", "laptop", "macbook",
                    "tablet", "tv", "television", "headphones", "earbuds",
                    "charger", "phone charger", "phone case", "usb",
                    "hdmi", "monitor", "keyboard", "camera", "speaker",
                    "smart watch", "console", "playstation", "xbox",
                    "air purifier", "humidifier", "vacuum cleaner"],
    "sports & hobbies": ["golf", "golf ball", "golf club", "tennis",
                         "tennis ball", "basketball", "football",
                         "soccer ball", "bike", "bicycle", "yoga mat",
                         "dumbbell", "fishing rod", "tent", "toy", "lego",
                         "board game", "puzzle", "video game"],
    "tickets & services": ["ticket", "tickets", "movie ticket",
                           "membership", "subscription", "parking",
                           "haircut", "dry cleaning", "oil change",
                           "tire", "tires", "tip", "delivery fee",
                           "service fee", "shipping", "uber eats", "doordash",
                           "grubhub", "postmates"],
}
STRONG = {"iphone", "ipad", "airpods", "laptop", "macbook", "golf",
          "gasoline", "diesel", "prescription", "playstation", "xbox",
          "headphones", "earbuds", "sneakers", "jeans"}


def _index():
    out = []
    for kind, phrases in OTHER_RULES.items():
        for ph in phrases:
            toks = aisles._norm(ph).split()
            if toks:
                out.append((kind, toks, len(toks) > 1 or toks[0] in STRONG))
    return out


_INDEX = _index()


def _other_rule(name, has_aisle):
    toks = aisles._norm(name).split()
    best = None   # (token count, kind)
    for kind, rt, strong in _INDEX:
        if has_aisle and not strong:
            continue
        n = len(rt)
        for i in range(len(toks) - n + 1):
            if all(aisles._tok_match(toks[i + j], rt[j]) for j in range(n)):
                if best is None or n > best[0]:
                    best = (n, kind)
                break
    return best[1] if best else None


def classify(name, verdicts=None):
    """-> {"kind": "grocery"|"other"|"unknown", "sub": str|None,
    "src": "user"|"model"|"rule"|"aisle"|None}. verdicts is the saved
    cache {key: {kind, sub, src}}; None means none."""
    key = _key(name)
    if not key:
        return {"kind": "unknown", "sub": None, "src": None}
    saved = (verdicts or {}).get(key)
    if saved and saved.get("src") == "user":
        return {"kind": saved["kind"], "sub": saved.get("sub"), "src": "user"}
    has_aisle = aisles.aisle_for(name) is not None
    sub = _other_rule(name, has_aisle)
    if sub:
        return {"kind": "other", "sub": sub, "src": "rule"}
    if has_aisle:
        return {"kind": "grocery", "sub": None, "src": "aisle"}
    if saved:
        return {"kind": saved["kind"], "sub": saved.get("sub"),
                "src": saved.get("src", "model")}
    return {"kind": "unknown", "sub": None, "src": None}


def load_verdicts():
    from api import state
    return state._load("grocery_verdicts.json", {})


def save_verdicts(new):
    """Merge new verdicts under the lock; a user's word is never
    overwritten by a model verdict."""
    from api import state
    with state.file_lock("grocery_verdicts.json"):
        cur = state._load("grocery_verdicts.json", {})
        for k, v in new.items():
            if cur.get(k, {}).get("src") == "user" and v.get("src") != "user":
                continue
            cur[k] = v
        state._save("grocery_verdicts.json", cur)
    return cur


def set_user_verdict(name, kind, sub=None):
    """The user's Keep ("it is groceries") or "not groceries"."""
    key = _key(name)
    if key and kind in ("grocery", "other"):
        save_verdicts({key: {"kind": kind, "sub": sub, "src": "user"}})


# --- the one model call, unknown names only -------------------------------

SUBS = list(OTHER_RULES) + ["other"]
MIN_CONF = 0.7
BATCH = 20
_SYSTEM = (
    "You sort shopping-list entries for a grocery app. For each entry "
    "say whether a shopper would buy it as groceries or household "
    "supplies (food, drink, cleaning, paper goods, toiletries, pet "
    "food, baby items) — answer \"grocery\" — or it is something else "
    "(gift cards, fuel, clothing, electronics, sports gear, tickets, "
    "services) — answer \"other\" with a sub of one of: "
    + ", ".join(SUBS) + ". Names may be in any language or a brand. "
    "When unsure answer \"grocery\" with low confidence; never guess "
    "\"other\" without clear evidence. Reply with JSON only: "
    "{\"verdicts\": [{\"name\": \"<as given>\", \"kind\": \"grocery\", "
    "\"sub\": null, \"confidence\": 0.0}]}")


def judge_unknown(names, client):
    """names: unknown names -> {key: verdict} for the confident ones.
    One Spark Standard call per BATCH names. Never raises; a failed
    call yields nothing, and the names stay unknown (= groceries)."""
    out = {}
    names = [n for n in dict.fromkeys(names) if _key(n)]
    for i in range(0, len(names), BATCH):
        chunk = names[i:i + BATCH]
        try:
            text, _usage, _cost = client.chat(
                [{"role": "system", "content": _SYSTEM},
                 {"role": "user", "content": "\n".join(chunk)}],
                mode="standard", personal=True, reasoning_effort="low",
                cache_key="arya-grocery-judge-v1")
            dec = json.loads(text[text.find("{"): text.rfind("}") + 1])
        except Exception:
            continue
        asked = {_key(n) for n in chunk}
        for v in dec.get("verdicts") or []:
            if not isinstance(v, dict):
                continue
            key = _key(str(v.get("name") or ""))
            kind = str(v.get("kind") or "").lower()
            try:
                conf = float(v.get("confidence") or 0)
            except (TypeError, ValueError):
                conf = 0.0
            if key not in asked or kind not in ("grocery", "other"):
                continue
            if conf < MIN_CONF:
                # Remembered as unsure, so it is not asked again.
                out[key] = {"kind": "unknown", "sub": None, "src": "model"}
                continue
            sub = str(v.get("sub") or "other").lower()
            out[key] = {"kind": kind,
                        "sub": (sub if sub in SUBS else "other")
                        if kind == "other" else None,
                        "src": "model"}
    return out
