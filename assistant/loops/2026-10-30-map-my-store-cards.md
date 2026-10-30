# 2026-10-30 — Map my store: Select store cards, one name

Owner (screenshot of the mapping screen): "this should be map my store,
the select store and start mapping"; then "show select store and show
store cards and find my store, and then start mapping. the chip is hard
to see". Mockup (artifact Vezd3D4yH26gAY6k3bUM4L), owner: "go".

- One name app-wide: "Map my store" (was "Map this store" in five
  strings). The logged-out landing card keeps its approved "Map your
  store" (it speaks to a visitor).
- screens/Mapper.tsx: a "Select store" heading, then your stores as
  cards (name, street and city, a check on the picked one; three at a
  time, the picked one always shown, the rest behind "Show all my
  stores"), then a "Find my store" card that opens the store search in
  place. A store added there becomes the picked card.
- Start mapping names the store ("Start mapping Costco Wholesale").
- Ids kept (#mp-stores, [data-mstore], #mp-findstore), so the order
  pins in tests/test_usability_pass.py still hold.

Tests: e2e/mapper (title, Select store, button names the picked store),
findstore and mapstore unchanged and passing.
