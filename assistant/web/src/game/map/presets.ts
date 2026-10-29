/* Store types as graphs: the starting point when Arya builds a store
 * from a few answers (Build), and the shape of a simulated store whose
 * type is known (a warehouse club is not a supermarket). Each is a
 * plain StoreGraph; solve() lays it out like any other. */
import { TEMPLATE, type StoreGraph, type Zone } from "./graph";

const z = (id: string, kind: Zone["kind"], band: Zone["band"], index: number, label: string, categories: string[], size?: Zone["size"]): Zone =>
  ({ id, kind, band, index, label, categories, ...(size ? { size } : {}) });

export type StoreType = "supermarket" | "warehouse" | "corner" | "health" | "indian";

export const PRESETS: Record<StoreType, { name: string; blurb: string; graph: StoreGraph }> = {
  supermarket: { name: "Supermarket", blurb: "Fresh food around the walls, aisles in the middle", graph: TEMPLATE },
  warehouse: {
    name: "Warehouse club", blurb: "Big pallets, long aisles, bulk packs",
    graph: {
      id: "warehouse", source: "template", size: "l",
      zones: [
        z("produce", "produce", "back", 0, "Produce cooler", ["banana", "apple", "berries", "berry", "grape", "avocado", "spinach", "lettuce", "salad", "onion", "potato", "fruit", "vegetable"], "l"),
        z("meat", "meat", "back", 1, "Meat & Seafood", ["chicken", "beef", "pork", "salmon", "fish", "shrimp", "turkey", "sausage", "bacon"]),
        z("dairy", "dairy", "back", 2, "Dairy & Eggs", ["milk", "egg", "cheese", "yogurt", "butter", "cream"], "l"),
        z("bakery", "bakery", "left", 0, "Bakery", ["bread", "bagel", "muffin", "croissant", "cake", "tortilla"]),
        z("frozen", "frozen", "right", 0, "Frozen", ["frozen", "ice cream", "pizza"]),
        z("deals", "produce", "front", 0, "Seasonal & Deals", ["flowers", "seasonal", "gift"]),
        z("snacks", "aisle", "centre", 0, "Aisle 1 · Snacks", ["chips", "cracker", "cookie", "snack", "nut", "chocolate"]),
        z("drinks", "aisle", "centre", 1, "Aisle 2 · Drinks", ["water", "soda", "juice", "coffee", "tea", "sparkling"]),
        z("pantry", "aisle", "centre", 2, "Aisle 3 · Pantry", ["pasta", "rice", "oil", "sauce", "beans", "soup", "flour", "sugar", "cereal", "oat", "peanut butter"]),
        z("paper", "aisle", "centre", 3, "Aisle 4 · Paper goods", ["paper", "towel", "tissue", "toilet", "napkin"]),
        z("cleaning", "aisle", "centre", 4, "Aisle 5 · Cleaning", ["soap", "detergent", "sponge", "trash", "foil", "dish"]),
        z("home", "aisle", "centre", 5, "Aisle 6 · Home & Baby", ["diaper", "wipes", "battery", "vitamin"]),
      ],
    },
  },
  corner: {
    name: "Corner store", blurb: "Small and quick: drinks, snacks, the basics",
    graph: {
      id: "corner", source: "template", size: "s",
      zones: [
        z("cold", "dairy", "back", 0, "Cold drinks & Milk", ["milk", "soda", "juice", "water", "egg", "yogurt", "beer"], "l"),
        z("hot", "deli", "left", 0, "Hot food", ["sandwich", "coffee", "hot dog", "prepared"]),
        z("frozen", "frozen", "right", 0, "Ice cream", ["frozen", "ice cream", "popsicle"]),
        z("snacks", "aisle", "centre", 0, "Aisle 1 · Snacks", ["chips", "cookie", "candy", "chocolate", "snack", "cracker"]),
        z("basics", "aisle", "centre", 1, "Aisle 2 · Basics", ["bread", "pasta", "rice", "soup", "can ", "cereal", "paper", "soap"]),
      ],
    },
  },
  health: {
    name: "Health food store", blurb: "Bulk bins, produce first, plant-based",
    graph: {
      id: "health", source: "template", size: "m",
      zones: [
        z("produce", "produce", "left", 0, "Organic produce", ["banana", "apple", "berries", "berry", "spinach", "kale", "lettuce", "avocado", "fruit", "vegetable", "herb", "ginger"], "l"),
        z("bulk", "produce", "front", 0, "Bulk bins", ["bulk", "granola", "almond", "nut", "seed", "lentil", "quinoa", "oat"]),
        z("bakery", "bakery", "back", 0, "Bakery", ["bread", "sourdough", "muffin", "gluten free"]),
        z("deli", "deli", "back", 1, "Prepared food", ["hummus", "salad bar", "soup", "prepared", "dip"]),
        z("dairy", "dairy", "back", 2, "Dairy & Plant milk", ["milk", "oat milk", "almond milk", "egg", "yogurt", "cheese", "kefir", "tofu"], "l"),
        z("frozen", "frozen", "right", 0, "Frozen", ["frozen", "ice cream"]),
        z("pantry", "aisle", "centre", 0, "Aisle 1 · Pantry", ["pasta", "rice", "oil", "sauce", "beans", "flour", "honey", "syrup"]),
        z("supplements", "aisle", "centre", 1, "Aisle 2 · Supplements", ["vitamin", "protein", "supplement", "tea", "kombucha"]),
        z("body", "aisle", "centre", 2, "Aisle 3 · Body care", ["soap", "shampoo", "lotion", "toothpaste", "detergent"]),
      ],
    },
  },
  indian: {
    name: "Indian grocer", blurb: "Spice wall, rice and atta, dal, sweets",
    graph: {
      id: "indian", source: "template", size: "m",
      zones: [
        z("produce", "produce", "left", 0, "Vegetables", ["okra", "bhindi", "chili", "chilli", "cilantro", "coriander", "methi", "curry leaves", "onion", "tomato", "potato", "ginger", "garlic", "lemon", "mango", "vegetable", "fruit"]),
        z("spices", "aisle", "left", 1, "Spice wall", ["masala", "turmeric", "haldi", "cumin", "jeera", "spice", "cardamom", "hing", "mustard seed", "chili powder"]),
        z("sweets", "bakery", "back", 0, "Sweets & Snacks", ["ladoo", "barfi", "jalebi", "namkeen", "bhujia", "rusk", "biscuit"]),
        z("dairy", "dairy", "back", 1, "Paneer & Dairy", ["paneer", "ghee", "dahi", "curd", "milk", "yogurt", "butter", "egg"], "l"),
        z("rice", "aisle", "centre", 0, "Aisle 1 · Rice & Atta", ["basmati", "rice", "atta", "flour", "besan", "sooji", "poha"]),
        z("dal", "aisle", "centre", 1, "Aisle 2 · Dal & Beans", ["dal", "lentil", "chana", "rajma", "moong", "toor", "urad"]),
        z("pickles", "aisle", "centre", 2, "Aisle 3 · Pickles & Chutney", ["pickle", "achaar", "chutney", "papad", "sauce", "tea", "chai"]),
        z("frozen", "frozen", "right", 0, "Frozen", ["paratha", "samosa", "naan", "frozen", "kulfi"]),
      ],
    },
  },
};
