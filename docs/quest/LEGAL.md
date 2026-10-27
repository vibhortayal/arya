# Legal watchlist — Arya Quest

Internal planning notes, written 2026-10-27. **This document is not legal advice.** It records the risks the design must respect and the mitigations already built into the product. A consumer-tech attorney reviews items 1–3 before any public launch.

## Gate summary

| Gate | Status |
|---|---|
| Hackathon build and demo | Nothing on this list blocks it |
| Demo video (Nov 3) | One rule: no third-party walkthrough footage (item 6) |
| Public launch | Attorney pass on items 1–3; VGGT license path (item 4); CPRA paperwork (item 5) |

## 1. Filming inside stores — private property

Stores are private property open to the public, not public space. Retailers can restrict photography (Costco's membership terms do), order a mapper to stop filming or leave, and treat refusal as trespass. The mapping supply chain therefore rests on retailer tolerance.

Mitigations in the design:
- In-app mapper rules: shelves and products only; stop when asked; follow posted store policy.
- Mapping credit never requires breaking a store rule; a refused walk earns no penalty.
- Rollout path includes permission programs with willing chains before scale.

## 2. Other people in walkthrough footage — privacy

Walkthrough video captures shoppers and staff: faces, children, and conversations. California and several other states require two-party consent for recorded conversations, and footage of children is the most sensitive class. Platform-level sharing multiplies the exposure.

Mitigations in the design:
- Capture is video-only; audio is stripped at intake.
- Faces are blurred in the mapping pipeline before any frame is stored or shared.
- No biometric identifiers are extracted, ever.
- Raw video retention is short; the platform keeps the model, not the footage.

## 3. Children are players, never account holders — COPPA

The family case is a design center: a child holds the phone and hunts while the adult runs the list. If a child under 13 held an account, a public handle, or messaging, COPPA's verifiable-parental-consent regime and state children's-privacy laws would apply in full.

Rules already in the design:
- The account holder is always the adult. A child is a player on the adult's session, never a user.
- Friends are handle-based between account holders; there is no chat, no DM, and no list sharing. Kid-safe by construction.

## 4. VGGT weights are non-commercial

VGGT / VGGT-Ω (Meta AI + Oxford) is open source with non-commercial weights. Use in the hackathon is within the license. A commercial launch needs a license from the rights holders or a different reconstruction engine. This is the one hard blocker on the current stack; everything else is process.

## 5. Receipts are sensitive personal information — CPRA

Receipts reveal diet, health-adjacent, and religion-adjacent purchases; session data reveals store visits. Both are sensitive personal information under California's CPRA and similar state laws.

The architecture already carries most of the answer: receipts, lists, and personal analysis are account-level and private; store models are platform-level and contain no personal data. Launch adds the paperwork: a real privacy policy, deletion on request, a no-sale posture, and data-minimization review.

## 6. Third-party footage — never in the demo

The VGGT spike runs on a walkthrough video downloaded from YouTube. Internal research use is one thing; the video belongs to its creator. The submitted demo video shows only Arya Quest output — the point cloud, the game, the score — never the source footage. The same rule applies to any mapper upload: the platform builds models from footage; it does not redistribute the footage.

## 7. Smaller items, handled by design

- **Store names** are used nominatively ("at Trader Joe's"). Store logos are never used, and no store endorsement is stated or implied.
- **Rewards stay status-only** (badges, points, credit lines). Cash prizes for races or mapping would trigger sweepstakes and contest law in several states; the design does not go there.
- **Shelf data is factual** (a product's location is an observed fact), but retailers may still send objections to mapping. The defense is the method: observation by shoppers in public view, no access to store systems, no scraping.
- **Safety copy** in the hunt ("walk, don't run; watch for other shoppers") is cheap prudence for a game played while moving through a store.
