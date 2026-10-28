# 2026-10-28 — phone passes 3 + filler fix + Google Places picker

Owner phone-testing live all afternoon; five rulings shipped as
PRs #51–#56 (all merged + deployed same day; suite 517+ green):

- Header removed (avatar floats); share-at-finish ungated
  (Discussion 57); voice/text sentence parsing + "Looks right?"
  confirm + Add buttons in both composers; quest abandon
  (Discussion 58).
- Filler-word follow-up: "Oh, I need some eggs..." made an "Oh"
  item — fillers/lead-ins now strip per fragment in all three
  parsers (quest.js, app.js preview, server intake).
- Google Places store picking (Discussion 59): api/places.py
  proxy (Autocomplete + Essentials Details), directory rows keyed
  by place_id, typed-name gate, Add-a-store form replaced by a
  Google search. Ships dark: provisioned:false until the owner
  adds GOOGLE_PLACES_API_KEY to the VM .env; compose passes it
  through. Local drives verified the gate both ways (typed
  non-store blocked; receipt-history store still plans).
- Next: owner provisions the key -> redeploy -> live-drive the
  suggestions; the Most Viral X post + teaser video rework.
