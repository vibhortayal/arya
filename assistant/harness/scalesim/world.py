"""The simulated neighbourhood: stores, products, shopper types.

Everything is invented. Store names are real-style chain names so the
demo reads naturally; the prices, layouts and traffic are made up and
must never be shown as real. Deterministic: no clock, no network.
"""

# name, pull (how much of the neighbourhood chooses it), aisle segments,
# price level, bulk store?, peak concurrent shoppers it can hold (for Packed)
STORES = [
    {"name": "Trader Joe's", "pull": 1.3, "segments": 22, "price": 1.00, "bulk": False, "capacity": 40},
    {"name": "Safeway", "pull": 1.6, "segments": 34, "price": 1.10, "bulk": False, "capacity": 70},
    {"name": "Costco", "pull": 1.0, "segments": 40, "price": 0.86, "bulk": True, "capacity": 160},
    {"name": "Whole Foods", "pull": 0.9, "segments": 30, "price": 1.22, "bulk": False, "capacity": 60},
    {"name": "Aldi", "pull": 0.8, "segments": 18, "price": 0.82, "bulk": False, "capacity": 35},
    {"name": "Target", "pull": 0.9, "segments": 28, "price": 1.04, "bulk": False, "capacity": 90},
    {"name": "Sprouts", "pull": 0.6, "segments": 20, "price": 1.08, "bulk": False, "capacity": 40},
    {"name": "Corner Market", "pull": 0.5, "segments": 10, "price": 1.30, "bulk": False, "capacity": 12},
]

CATEGORIES = ["Produce", "Dairy", "Bakery", "Meat", "Frozen", "Pantry", "Snacks", "Drinks", "Household"]

# id, name, category, base price (USD, invented), buy every N days, share of
# households that buy it at all
ITEMS = [
    ("milk", "Whole Milk 1 gal", "Dairy", 4.20, 7, 0.85),
    ("eggs", "Eggs 12 ct", "Dairy", 5.60, 12, 0.85),
    ("butter", "Butter 1 lb", "Dairy", 5.10, 28, 0.60),
    ("yogurt", "Greek Yogurt 32 oz", "Dairy", 5.40, 14, 0.55),
    ("cheese", "Cheddar 8 oz", "Dairy", 3.90, 21, 0.60),
    ("bananas", "Bananas 1 lb", "Produce", 0.69, 6, 0.90),
    ("apples", "Apples 3 lb", "Produce", 4.80, 10, 0.60),
    ("spinach", "Baby Spinach 16 oz", "Produce", 3.90, 9, 0.50),
    ("avocado", "Avocados 4 ct", "Produce", 5.20, 11, 0.55),
    ("tomatoes", "Tomatoes 1 lb", "Produce", 2.40, 8, 0.65),
    ("onions", "Yellow Onions 3 lb", "Produce", 3.10, 18, 0.65),
    ("potatoes", "Potatoes 5 lb", "Produce", 4.40, 20, 0.55),
    ("lettuce", "Romaine Hearts 3 ct", "Produce", 3.80, 10, 0.45),
    ("berries", "Blueberries 12 oz", "Produce", 4.60, 9, 0.40),
    ("bread", "Sandwich Bread", "Bakery", 3.80, 8, 0.80),
    ("bagels", "Bagels 6 ct", "Bakery", 4.20, 14, 0.35),
    ("tortillas", "Tortillas 10 ct", "Bakery", 3.30, 14, 0.40),
    ("chicken", "Chicken Breast 1 lb", "Meat", 6.90, 9, 0.60),
    ("beef", "Ground Beef 1 lb", "Meat", 7.40, 12, 0.45),
    ("salmon", "Salmon Fillet 1 lb", "Meat", 12.50, 16, 0.25),
    ("bacon", "Bacon 12 oz", "Meat", 6.80, 20, 0.35),
    ("tofu", "Tofu 14 oz", "Meat", 2.60, 14, 0.25),
    ("frozen_veg", "Frozen Vegetables", "Frozen", 2.50, 14, 0.50),
    ("pizza", "Frozen Pizza", "Frozen", 6.50, 16, 0.40),
    ("icecream", "Ice Cream 1.5 qt", "Frozen", 5.90, 20, 0.40),
    ("dumplings", "Dumplings 24 oz", "Frozen", 7.20, 24, 0.20),
    ("rice", "Rice 5 lb", "Pantry", 7.60, 35, 0.60),
    ("pasta", "Pasta 1 lb", "Pantry", 1.90, 14, 0.75),
    ("sauce", "Pasta Sauce 24 oz", "Pantry", 3.40, 21, 0.60),
    ("beans", "Black Beans 15 oz", "Pantry", 1.30, 16, 0.50),
    ("oil", "Olive Oil 17 oz", "Pantry", 9.50, 60, 0.55),
    ("flour", "Flour 5 lb", "Pantry", 4.10, 60, 0.30),
    ("sugar", "Sugar 4 lb", "Pantry", 3.60, 70, 0.30),
    ("coffee", "Coffee Beans 12 oz", "Pantry", 11.00, 18, 0.60),
    ("tea", "Tea 20 ct", "Pantry", 3.80, 30, 0.35),
    ("cereal", "Cereal 12 oz", "Pantry", 4.60, 14, 0.50),
    ("oats", "Oats 18 oz", "Pantry", 3.90, 28, 0.35),
    ("pb", "Peanut Butter 16 oz", "Pantry", 3.70, 28, 0.50),
    ("jam", "Jam 12 oz", "Pantry", 3.60, 45, 0.25),
    ("chips", "Tortilla Chips", "Snacks", 3.60, 14, 0.55),
    ("crackers", "Crackers", "Snacks", 3.40, 21, 0.40),
    ("nuts", "Mixed Nuts 16 oz", "Snacks", 8.90, 24, 0.35),
    ("cookies", "Cookies", "Snacks", 3.90, 18, 0.40),
    ("juice", "Orange Juice 52 oz", "Drinks", 4.50, 10, 0.50),
    ("soda", "Sparkling Water 12 ct", "Drinks", 5.80, 12, 0.45),
    ("beer", "Beer 6 pk", "Drinks", 10.50, 14, 0.25),
    ("wine", "Red Wine", "Drinks", 12.00, 20, 0.25),
    ("paper_towel", "Paper Towels 6 ct", "Household", 9.50, 30, 0.75),
    ("tp", "Toilet Paper 12 ct", "Household", 13.00, 35, 0.80),
    ("detergent", "Laundry Detergent", "Household", 11.50, 50, 0.65),
    ("dish_soap", "Dish Soap", "Household", 3.40, 40, 0.70),
    ("trash_bags", "Trash Bags 30 ct", "Household", 7.80, 45, 0.60),
]

# shopper types: share, trips/week, main stores (weights), bulk trip every N weeks
ARCHETYPES = [
    {"name": "Family", "share": 0.28, "trips": 1.6, "basket": 1.0, "bulk_every": 3,
     "prefer": {"Safeway": 3, "Costco": 2, "Target": 1, "Trader Joe's": 1}},
    {"name": "Couple", "share": 0.22, "trips": 1.3, "basket": 0.75, "bulk_every": 6,
     "prefer": {"Trader Joe's": 3, "Safeway": 2, "Whole Foods": 1, "Sprouts": 1}},
    {"name": "Single", "share": 0.20, "trips": 1.2, "basket": 0.5, "bulk_every": 0,
     "prefer": {"Trader Joe's": 3, "Corner Market": 2, "Safeway": 2, "Aldi": 1}},
    {"name": "Budget", "share": 0.15, "trips": 1.4, "basket": 0.85, "bulk_every": 4,
     "prefer": {"Aldi": 4, "Costco": 2, "Safeway": 1}},
    {"name": "Health", "share": 0.10, "trips": 1.7, "basket": 0.7, "bulk_every": 0,
     "prefer": {"Whole Foods": 3, "Sprouts": 3, "Trader Joe's": 2}},
    {"name": "Senior", "share": 0.05, "trips": 1.1, "basket": 0.6, "bulk_every": 0,
     "prefer": {"Safeway": 3, "Corner Market": 3}},
]

# when people shop: relative weight by weekday (Mon=0), and by hour
DOW = [0.9, 0.8, 0.9, 1.0, 1.3, 2.0, 1.6]
HOUR = {8: 0.4, 9: 0.9, 10: 1.6, 11: 2.0, 12: 1.6, 13: 1.2, 14: 1.0, 15: 1.0,
        16: 1.3, 17: 2.0, 18: 2.1, 19: 1.4, 20: 0.7}

# behaviour assumptions (every one of these is a stated assumption, not a measurement)
ASSUME = {
    "share_prices": 0.35,        # households that opt in to community prices
    "share_presence": 0.40,      # users that opt in to Arya Shoppers
    "mapper": 0.08,              # users willing to take a shelf photo
    "capture_per_trip": 0.3,     # chance a mapper takes a photo on a trip
    "not_here": 0.05,            # item not on the shelf where expected
    "substitute": 0.03,
    "report_rate": 0.4,          # share of "not here" moments the shopper taps to report
    "layout_change_per_week": 0.015,   # chance a shelf segment is rearranged
    "stockout_per_week": 0.03,   # chance an item is out at a store
    "group_share": 0.18,         # users that sit in a shared Group
    "trip_minutes": 35,
    "community_k": 5,            # households needed before a community price shows
    "community_days": 30,
    "alert_reports": 3,          # not-here reports (3 households, 7 days) before a store alert
}

SEED = 20261029
