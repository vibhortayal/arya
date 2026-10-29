# 2026-10-29 · Discrepancy card (owner wireframe, approved 09:11 ET)

Owner's rule: "keep it simple, if there is discrepancy, show card,
ask user" + "for user perspective it's all arya". Wireframe shown
and approved the same morning.

Built exactly to it: the Receipts proposal area is now one card
per pending question. Merge: "Are these the same item?" + the
names + "Arya is asking because the names look alike. Nothing
changes unless you choose." + [Yes, same item] [No, keep
separate]. Split flips the question ("Should these stay
separate?") and the outcome labels; the recommended answer is the
primary button. Answering settles the proposal and the card goes
away with a short confirmation. Gone: the explainer paragraph,
the Apply/Dismiss chips, and the manual "Ask the Curator" button
(no trigger on Receipts — a run still starts from the Ask side).
With nothing pending the whole area stays hidden (v83 gating).

Also folded in the all-Arya rename's remainder: the identity
prompt opens "You are Arya, tending a household grocery model",
and the architecture test's fake client routes on that stable
phrase instead of the old persona name. Code identifiers
(renderCurator, /api/curator) stay — internal only.

SW arya-v95.
