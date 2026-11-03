# 2026-11-03 "From Alexa" card on Today (hidden)

- Ask (owner via coordinator; mockup 93u3oRPsr5TeBzm9TFDwNo approved 00:23Z): a Today card for UNCLEAR Alexa adds only. Clear adds never show.
- Contract agreed with the builder (branch alexa-skill): GET /api/alexa/review -> {items:[{id,item_id?,name,heard,kind guess|unchecked,list_id,list_name,at}]}, 404 while the flag is off / demo / tokens. POST .../{id}/confirm|reopen|move{list_id}|rename{name}|remove, each returns the GET body.
- Web: screens/todayAlexa.tsx (card + Fix sheet), "alexa" card id (todayCards + account.py TODAY_CARDS). It leads Today, and is hideable in Customize only while the flag is on. withAlexa() adds it once to an arranged Today; today_sizes.alexa marks it offered, so a remove sticks. Right = confirm + Undo (reopen); move/rename/remove have no Undo (the builder's reopen only undoes confirm).
- Hidden feature: no Help, guide, Ask sheet or docs changes.
- Checked: web 548, Python pass; local server + stubbed review endpoint at 360x640, 390x844, 430x932, 390x568 (card, Fix sheet, Right + toast, empty); unstubbed (404): no card, not in Customize.
