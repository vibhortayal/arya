# 2026-10-30 — In the store: one compact panel, zoom and turn

Owner: "I should see list when am grabbing stuff too?", "why is there
'x' icon here", "am not understanding this user experience". Mockup
(artifact 22Pj3b3qwMTDTVCCw4DTHm), then "losing too much real estate
... make these panels and icons smaller ... I want to be able to zoom
into the store view or rotate it". Version 2 approved ("go").

Before: the bottom switched between an item card (Grab it, Not here,
Substitute, Skip, and an X meaning "walk away without deciding") and a
dock (item pictures, Next, List, Checkout). Two states, nothing said so.

Now (game/ui/Play.tsx), one panel that never switches:
- Top: the whole list as small pictures (got ones faded, the current one
  outlined; tap one to walk there) and "List · N left ›" for the sheet.
- Below: the item you are at, with Got it / Can't find it / Later on one
  row. Can't find it holds Ask staff, Shelf empty, Somewhere else, and
  Take something else instead (Substitute moved here). No X.
- Got it walks the shopper to the next item by itself; Undo sits on the
  "Heading to …" line. Head to checkout shows only once everything is
  decided.
- Compact: slimmer header and cart pill, 30px list pictures, 48px item
  art with a one-line hint, 46px buttons. Roughly a third more store.

Store view (world/World3D.tsx): pinch to zoom, two fingers to turn, the
mouse wheel zooms on a computer; one finger still taps. The compass
button resets a zoom or turn, else flips between following the shopper
and the whole store. A one-time "Pinch to zoom · two fingers to turn"
hint. This replaces the earlier "one automatic store view" rule.

Tests: e2e/instore (strip at the shelf, no X, Got it walks on, List
button), Play.test (Got it); fogsnap keeps the nudge while walking on.
