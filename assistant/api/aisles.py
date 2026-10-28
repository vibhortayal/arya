"""Aisles — which album page a product belongs to (Game: album).

Pure, deterministic, $0, no model calls and no network. The album
sorts a sticker by its product name (and the stop's shelf label when
the hunt matched one). The page is re-derived on every read, so a
better keyword map moves items to the right page without a migration.

Matching rule: whole phrases, not substrings. "ice cream" is Frozen
before "cream" is Dairy; "peanut butter" is Pantry before "butter";
"eggplant" is not "egg". A longer phrase beats a shorter one. Names
may be plural ("paper towels"). Names the map does not know return
None, and the album files them under "Other finds".
"""
import json
import os
import re

AISLES = ["Produce", "Bakery", "Deli", "Dairy", "Pantry", "Frozen", "Household"]
SLOTS = 8
OTHER = "Other finds"

# Seasonal pages (owner wireframe: starts on the first matching find,
# never expires). The window only decides when the teaser shows for a
# shopper who has not found one yet.
SEASONS = [
    {"id": "Halloween", "title": "Halloween",
     "keywords": ["pumpkin", "halloween", "candy corn", "jack o lantern",
                  "trick or treat", "caramel apple", "spooky", "witch hat"],
     # Canned or pureed pumpkin is baking stock, not a seasonal find:
     # it stays on its aisle page all year.
     "unless": ["canned", "puree", "pie filling", "pie spice"],
     "window": ((9, 15), (11, 5)), "badge": "Pumpkin King"},
]

# One badge per page. The owner may rename any of them.
PAGE_BADGES = {
    "Dairy": "Dairy Royalty", "Produce": "Garden Party",
    "Pantry": "Pantry Pro", "Bakery": "Crumb Collector",
    "Deli": "Deli Darling", "Halloween": "Pumpkin King",
    "Frozen": "Cool Customer", "Household": "Home Base",
}

# --- the keyword map ---------------------------------------------------------
# Phrases are singular; a plural name still matches. A modifier such
# as "frozen" carries extra weight, so "frozen peas" is Frozen.
_MODIFIER_WEIGHT = 5

_RULES = {
    "Frozen": [
        "frozen", "ice cream", "gelato", "sorbet", "popsicle", "ice pop",
        "ice cube", "pizza", "waffle", "tater tot", "hash brown",
        "fish stick", "frozen dinner", "pot pie", "dumpling", "potsticker",
        "burrito", "ice", "freezer", "frozen foods", "edamame", "fro yo",
        "frozen yogurt", "sherbet",
    ],
    "Dairy": [
        "milk", "oat milk", "almond milk", "soy milk", "coconut milk drink",
        "cheese", "yogurt", "yoghurt", "butter", "cream", "half and half",
        "creamer", "sour cream", "cream cheese", "cottage cheese", "egg",
        "kefir", "dairy", "ghee", "whipped cream", "mozzarella", "cheddar",
        "parmesan", "feta", "ricotta", "brie", "gouda", "swiss", "provolone",
        "butter milk", "buttermilk",
    ],
    "Produce": [
        "produce", "fruit", "vegetable", "veggie", "salad", "lettuce",
        "spinach", "kale", "arugula", "cabbage", "broccoli", "cauliflower",
        "carrot", "celery", "cucumber", "tomato", "potato", "sweet potato",
        "onion", "garlic", "ginger", "pepper", "bell pepper", "jalapeno",
        "mushroom", "zucchini", "squash", "eggplant", "asparagus", "corn",
        "pea", "green bean", "avocado", "banana", "apple", "pear", "peach",
        "plum", "nectarine", "apricot", "cherry", "grape", "melon",
        "watermelon", "cantaloupe", "berry", "strawberry", "blueberry",
        "raspberry", "blackberry", "orange", "mandarin", "clementine",
        "tangerine", "lemon", "lime", "grapefruit", "pineapple", "mango",
        "kiwi", "papaya", "pomegranate", "herb", "basil", "cilantro",
        "parsley", "mint", "radish", "beet", "turnip", "leek", "shallot",
        "scallion", "green onion", "cabbage", "brussels sprout", "artichoke",
        "pumpkin", "fig", "date", "coconut", "sprout", "bok choy",
    ],
    "Bakery": [
        "bakery", "bread", "sourdough", "baguette", "bagel", "croissant",
        "muffin", "donut", "doughnut", "cake", "cupcake", "pastry", "roll",
        "bun", "brioche", "ciabatta", "focaccia", "pita", "tortilla",
        "naan", "scone", "danish", "pie", "cookie", "brownie", "loaf",
        "english muffin", "hamburger bun", "hot dog bun",
    ],
    "Deli": [
        "deli", "hummus", "salami", "ham", "turkey", "prosciutto",
        "pastrami", "bologna", "pepperoni", "sliced meat", "lunch meat",
        "cold cut", "rotisserie", "meat", "chicken", "beef", "steak",
        "pork", "bacon", "sausage", "hot dog", "ground beef", "lamb",
        "fish", "salmon", "tuna steak", "shrimp", "seafood", "olive bar",
        "guacamole", "tzatziki", "dip", "potato salad", "coleslaw",
        "tofu", "tempeh", "prepared meal", "sushi", "fresh pasta",
    ],
    "Pantry": [
        "pantry", "pasta", "spaghetti", "penne", "macaroni", "noodle",
        "rice", "quinoa", "couscous", "oat", "oatmeal", "cereal",
        "granola", "flour", "sugar", "salt", "baking soda", "baking powder",
        "yeast", "honey", "syrup", "maple syrup", "jam", "jelly",
        "peanut butter", "almond butter", "nut butter", "nutella",
        "olive oil", "oil", "vinegar", "sauce", "pasta sauce", "tomato sauce",
        "ketchup", "mustard", "mayonnaise", "mayo", "salsa", "soy sauce",
        "hot sauce", "bbq sauce", "dressing", "spice", "seasoning",
        "canned", "can", "soup", "broth", "stock", "bean", "lentil",
        "chickpea", "nut", "almond", "walnut", "cashew", "peanut", "pecan",
        "raisin", "dried", "cracker", "chip", "pretzel", "popcorn", "snack",
        "granola bar", "bar", "candy", "chocolate", "coffee", "tea",
        "juice", "soda", "water", "sparkling water", "drink", "beverage",
        "kombucha", "wine", "beer", "pickle", "olive", "tuna", "cocoa",
        "pancake mix", "baking", "pudding", "gelatin", "tahini", "puree",
        "tomato paste", "canned goods", "breakfast",
        # Phrases whose first word names another aisle ("corn" is
        # Produce, "cake" is Bakery). The longer phrase wins.
        "corn flake", "corn starch", "cornstarch", "corn syrup", "corn meal",
        "black pepper", "white pepper", "pepper flake", "ginger ale",
        "ginger beer", "rice cake", "pumpkin puree", "canned pumpkin",
        "pumpkin pie filling",
    ],
    "Household": [
        "household", "paper towel", "toilet paper", "tissue", "napkin",
        "paper plate", "trash bag", "garbage bag", "bin liner", "foil",
        "aluminum foil", "plastic wrap", "cling film", "sandwich bag",
        "zip bag", "detergent", "laundry", "dish soap", "dishwasher",
        "sponge", "cleaner", "bleach", "disinfectant", "wipe", "soap",
        "hand soap", "shampoo", "conditioner", "toothpaste", "toothbrush",
        "deodorant", "razor", "lotion", "sunscreen", "battery", "light bulb",
        "candle", "cleaning", "paper goods", "diaper", "pet food",
        "cat litter", "dog food", "cat food", "air freshener",
        "fabric softener", "mop", "broom", "vitamin", "bandage",
    ],
}

# Words that make a phrase heavier than its length (a modifier names
# the aisle outright). Everything else weighs its token count.
_MODIFIERS = {"frozen", "canned", "dried", "fresh pasta"}


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def _tok_match(name_tok, rule_tok):
    """A name token matches a singular rule token as is, or plural."""
    if name_tok == rule_tok:
        return True
    if name_tok == rule_tok + "s" or name_tok == rule_tok + "es":
        return True
    if rule_tok.endswith("y") and name_tok == rule_tok[:-1] + "ies":
        return True
    return False


def _build_index():
    idx = []   # (weight, aisle, tokens)
    for aisle, phrases in _RULES.items():
        for ph in phrases:
            toks = _norm(ph).split()
            if not toks:
                continue
            w = len(toks) * 2
            if ph in _MODIFIERS or (len(toks) == 1 and toks[0] in _MODIFIERS):
                w = _MODIFIER_WEIGHT * 2
            idx.append((w, aisle, toks))
    return idx


_INDEX = _build_index()


def _classify(text):
    toks = _norm(text).split()
    if not toks:
        return None
    best = None   # (weight, position, aisle)
    for w, aisle, rt in _INDEX:
        n = len(rt)
        for i in range(len(toks) - n + 1):
            if all(_tok_match(toks[i + j], rt[j]) for j in range(n)):
                # A longer phrase wins; at equal weight the later word
                # (the head noun: "oat milk" is milk) wins.
                key = (w, i + n)
                if best is None or key > best[0]:
                    best = (key, aisle)
                break
    return best[1] if best else None


def aisle_for(name, shelf_label=None):
    """The aisle page for a product, or None when the map does not
    know it. The product name decides. The shelf label from the hunt
    is a fallback for a name the map does not know: a shelf label is
    often mixed ("Cheese & Dip Shelf") and the shelf match is
    approximate, so it must never overrule a clear product name."""
    hit = _classify(name)
    if hit:
        return hit
    if shelf_label:
        return _classify(shelf_label)
    return None


# --- seasons -----------------------------------------------------------------

def _has_phrase(toks, phrase):
    kt = _norm(phrase).split()
    return any(all(_tok_match(toks[i + j], kt[j]) for j in range(len(kt)))
               for i in range(len(toks) - len(kt) + 1))


def season_for(name):
    """The season id whose keyword the name carries, or None."""
    toks = _norm(name).split()
    if not toks:
        return None
    for s in SEASONS:
        if any(_has_phrase(toks, u) for u in s.get("unless", [])):
            continue
        for kw in s["keywords"]:
            kt = _norm(kw).split()
            for i in range(len(toks) - len(kt) + 1):
                if all(_tok_match(toks[i + j], kt[j]) for j in range(len(kt))):
                    return s["id"]
    return None


def season_by_id(season_id):
    for s in SEASONS:
        if s["id"] == season_id:
            return s
    return None


def season_visible(season, today):
    """True when today falls inside the season window (month/day,
    both ends included). `season` is a SEASONS row or its id."""
    if isinstance(season, str):
        season = season_by_id(season)
    if not season:
        return False
    (m1, d1), (m2, d2) = season["window"]
    cur = (today.month, today.day)
    start, end = (m1, d1), (m2, d2)
    if start <= end:
        return start <= cur <= end
    return cur >= start or cur <= end


def page_for(name, shelf_label=None):
    """The page id a sticker lands on: its season, else its aisle,
    else Other finds."""
    return season_for(name) or aisle_for(name, shelf_label) or OTHER


# --- stock art (port of the client's qFaceFor) -------------------------------

_MANIFEST = None
_MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets",
                              "characters", "manifest.json")


def _manifest():
    global _MANIFEST
    if _MANIFEST is None:
        try:
            with open(_MANIFEST_PATH, encoding="utf-8") as fh:
                _MANIFEST = json.load(fh)
        except (OSError, ValueError):
            _MANIFEST = {"items": [], "categories": [], "fallback": "basket.webp"}
    return _MANIFEST


def _contains(tokens, kw):
    kt = kw.split(" ")
    for i in range(len(tokens) - len(kt) + 1):
        if all(tokens[i + j] == kt[j] for j in range(len(kt))):
            return True
    return False


def art_for(name):
    """The stock character file for a name: an exact item rule, then
    its category, then the basket. Exact port of qFaceFor."""
    m = _manifest()
    tokens = [t for t in _norm(name).split(" ") if t]
    item = cat = None
    for r in m.get("items", []):
        if item is None and any(_contains(tokens, _norm(k)) for k in r.get("keywords", [])):
            item = r
    for c in m.get("categories", []):
        if cat is None and any(_contains(tokens, _norm(k)) for k in c.get("keywords", [])):
            cat = c
    char = (item and item.get("char")) or (cat and cat.get("char"))
    return char or m.get("fallback") or "basket.webp"
