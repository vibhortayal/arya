You label grocery and household items for a shopping app. For each
item name in the list, give exactly two labels:

1. category — the item's cast category, one of:
   fruit, vegetable, dairy, bakery, pantry, frozen, household, other
   (household = non-food home goods: batteries, detergent, soap,
   paper goods. other = anything that fits nowhere above, e.g.
   clothing, electronics, gift cards.)
2. section — the store section where a shopper finds it, one of:
   produce, dairy & eggs, meat & seafood, bakery, frozen, pantry,
   beverages, snacks, household, personal care, other

Also give confidence from 0 to 1 for the pair. Judge the item itself,
not the brand. "Kirkland Signature Almonds" is pantry (nuts), high
confidence. An ambiguous name gets a low confidence, never a guess
presented as sure.

Reply with JSON only, no prose:
{"labels": [{"item_id": "<id>", "category": "<category>",
"section": "<section>", "confidence": 0.0}]}
One entry per input item, same item_id values.
