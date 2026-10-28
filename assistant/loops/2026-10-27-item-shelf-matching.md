# Item–shelf matching — 2026-10-27 (night)

**Problem.** In a Trader Joe's cloud hunt, stops were placed along
the camera path in list order, alternating sides, and the shelf
chip named the graph label nearest the marker's *path position* —
it never looked at the item. "Organic Milk" could sit under a
"Pasta Shelf" chip. (External review, verified in scene.js.)

**Design.** Matching runs server-side at session creation, only
for stores with a shelf graph (`api/shelfmatch.py`; graphs are
discovered data-driven from `pwa/models/*/shelf-graph.json`, keyed
by store name with punctuation removed, so "Trader Joe's" meets
"trader-joes"):

1. Deterministic pass ($0): normalized token overlap between the
   item name and the graph's named labels, scored by token rarity
   across labels (sum of 1/df). A match needs score >= 0.5 and a
   clear winner after tie-breaks (score, tighter label, walk
   order). "Pasta Sauce" -> Pasta Sauce Shelf and "Organic Milk"
   -> Milk & Dairy Shelf land here; a lone common token ("cheese",
   in three labels) deliberately does not.
2. Model pass: ONE batched Muse Spark 1.3 Standard call
   (reasoning_effort=low, personal=True — session lists are
   personal data) with the unmatched items + the full named-label
   list. The model returns a label from the list or null; an
   invented label is discarded. A failed/unparseable call returns
   None and is *not* cached, so a transient failure is never
   stored as a verdict.
3. Cache: verdicts in `shelf_matches.json` (per account, the
   judged.json pattern), keyed by graph + normalized item name,
   nulls included — a repeat item never costs a second call.

Each stop records `shelf_label`, `shelf_u` (the matched label's
first walk-order occurrence; a side-less first sighting borrows a
later occurrence's side), `shelf_side`, `match_source`
("exact" | "model" | null). Matched stops are ordered by shelf_u;
unmatched stops keep list order after them. Matching never raises
into creation and scoring/completion ignore it — a session
completes with unmatched stops. Shop-Off sessions get the same
treatment (the route passes its client through). Sessions for
stores with no graph are byte-identical to before; the demo
household cannot create sessions at all (read-only 403), so its
behavior is unchanged.

**PWA.** `qStops` carries the shelf fields through. Cloud driver:
matched markers anchor at `shelf_u * pathLength` on the graph
side (stops sharing a shelf spread a step apart along the path);
the chip shows the stop's own matched label, falling back to the
Stage D nearest-label behavior only when the stop has none. Strip
driver: the matched shelf label prints on the stop card; an
unmatched stop in a graphed store reads "Not placed on the map".
SW cache arya-v18 (the two SW pins moved with the bump, as in
Stage E).

**Cost shape.** $0 for deterministic and cached items. Worst case
per session: one batched Standard call for the still-unmatched
items (~a few hundred tokens in, tens out — well under a cent);
steady state trends to $0 as the cache fills.

**Tests.** 20 new in tests/test_shelf_match.py (deterministic
cases, model reply parsing incl. invented-label and failure
handling, ordering/fields/sources, cache hit + cached null,
failure-never-breaks-creation, no-graph session unchanged,
completion with unmatched stops, API response shape, demo 403).
Suite: **166 green**. No live model calls were run.
