# Arya — Architecture (as built)

Status: living document. This revision describes the system as it runs on
October 27, 2026. SPEC.md states the product rules. This document states
how the built system is put together. Where the two disagree, SPEC.md
wins for behavior and this document wins for structure.

## 1. The shape: two layers

Arya has two layers. Each layer does the work it is good at.

- **The edge** is the user's own Muse. It sees the media: receipt
  photos, PDFs, pasted orders, fridge photos. It reads them and sends
  Arya structured data only. Arya holds no receipt images. The evidence
  stays with the user. This is an accepted trade-off, recorded in
  SPEC.md.
- **The core** is the Arya server. It verifies, remembers, reasons, and
  answers. It spends no tokens on reading media.

The rule between the layers: **the client proposes, Arya disposes.**
Client data is untrusted. Totals must reconcile in code before a receipt
is accepted. Low-confidence lines go to the review queue.

## 2. Intake paths

All paths end in one contract: a decoded receipt with lines, subtotal,
tax, and total.

1. **Structured intake (primary).** POST /api/intake/structured. The
   user's Muse posts the decoded receipt as JSON. The server recomputes
   every line status; a subtotal that does not match the lines fails
   reconciliation and is marked, never silently accepted.
2. **Order text.** POST /api/intake/order-text. A pasted online order
   (Instacart, Amazon) is extracted server-side, then follows the same
   path. Delivery fees and tips are excluded by rule.
3. **Server decode (fallback).** PDF text and photo decode endpoints
   remain for clients that cannot decode at the edge. They use the
   Model API under the model policy (MODEL-POLICY.md).
4. **Costco JSON export.** Bootstrap seed only. It is not a product
   intake path.

## 3. Verification in code (no model, no cost)

- Arithmetic: line totals must sum to the subtotal within 5 cents.
- Line status: auto at confidence 0.8 or above, else unverified and into
  the review queue.
- **Discount lines are structure, not identity.** A discount line
  (Costco prints it as "/<item number>") attaches to its parent item —
  named on the receipt, else the previous item line — and is always
  auto-verified. It never enters the review queue, on any path.
- Fee lines are classified once and never enter patterns or the list.

## 4. Identity: what things are

Three mechanisms, in order of strength.

1. **The dictionary** maps each store SKU to a canonical name. A name the
   user confirms teaches the dictionary. An item whose name cannot be
   established is **unresolved**: off the list, out of patterns, waiting
   in the review queue. Arya never guesses a name.
2. **Groups.** Products are grouped by an explicit group key when one is
   set, else by their normalized name. Costco re-SKUs the same product
   under one name; the group is the product everywhere it matters —
   patterns, ledger, list. Merges and splits set the explicit key.
3. **The Curator** (server-side reasoning) proposes merges and splits
   inside candidate clusters built in code at no cost. The model judges
   a cluster under a strict doctrine: same product only; never across
   organic vs conventional, form, flavor, fat content, or a size that
   makes a different product; when in doubt, keep separate. **A proposal
   changes nothing until the user applies it. No silent edits, ever.**
   Proposals the dictionary has already overtaken (members already one
   group, a duplicate, a split already in effect) retire automatically
   as *superseded* and are never shown.

## 5. The Resolver: research at the edge

Arya's server models have no web access. Identification from the outside
world is therefore an edge job, run by the user's Muse:

- Trigger: an unresolved dictionary item, or an unverified receipt line
  whose name is abbreviated or unreadable.
- Method: the retailer's own catalog first. A store item number matched
  on the retailer's site (for Costco: costco.com and its same-day
  storefront) is the strongest evidence. Then the wider web.
- Output: candidates **with source URLs**, posted to Arya
  (POST /api/review/suggest) and shown in the review queue next to the
  item or line. Research is evidence, not a verdict: the user settles
  with one tap, and settling teaches the dictionary.
- A brand initial alone is not evidence. Items with no catalog match
  stay open.

## 6. The reasoning agents in the core

Each agent has a narrow job and a named limit.

- **Staple judge.** Input: pattern facts only (buys, cadence, quantities
  — computed in code). Output: STAPLE, SEASONAL, OCCASIONAL, ONE_OFF, or
  NOT_CONSUMABLE per product. The verdict gates admission to the list.
  Explicit user intent always beats the judge. Unjudged and unresolved
  items stay off the list.
- **Curator.** See §4. Proposes identity changes; never applies them.
- **Eyes.** Fridge, pantry, and freezer photos filed at the edge become
  sightings. A sighting is pending until the user confirms it. Unseen is
  unknown: Eyes never edits inventory on its own.
- **Ask Arya.** Chat over a household snapshot. Actions (add to list,
  ran out, mark expired, never suggest, snooze) are validated
  server-side. Numbers come from the data, never from the model. Demo
  sessions cannot chat.

## 7. Money rules (summary; SPEC.md owns the detail)

- Returns are first-class: FIFO netting against buys, refunds reconcile
  into spend, patterns count kept items only, a returned item is never
  re-suggested.
- Every line carries an allocation: HOUSEHOLD (default) or FOR-OTHERS.
  For-others spend is in the ledger, never in patterns, inventory, or
  the list.
- The list is a derived view of the inventory model, never the source
  of truth.

## 8. Accounts, tokens, and the connector

- Per-user state lives in files under data/users/<account>/. Passwords
  are PBKDF2 hashes; sign-in is throttled; sessions are cookies.
- A connector token is `arya_` plus a random secret. **Only its SHA-256
  hash is stored.** It is shown once at mint; minting a new one replaces
  the old; it can be revoked at any time. Bearer tokens are accepted
  alongside session cookies. Demo accounts cannot mint.
- The Muse connector (custom.arya) carries its own instruction doc:
  operations, when to file, the verification rules, the Resolver
  procedure, filing hygiene. **The doc is the standing prompt.** The
  user writes no prompt.
- Routing is contextual. A receipt, an order, or a question about the
  user's own list, spend, or inventory goes to Arya. A general question
  does not. "Arya, …" always routes. Ambiguous input: ask, or state
  the assumption.

## 9. Onboarding

1. Create an account. A real account with no token lands on a Connect
   Muse step before the app shell. Demo accounts skip it.
2. Mint the token in Arya (shown once).
3. Add the Arya connector in Muse; paste the token into the secure
   form. Never into a chat message.
4. Talk to Muse. The Connect step inside Arya carries these steps and
   a copyable fallback setup prompt for assistant apps that do not load
   the connector doc automatically.

## 10. Cost control

- MODEL-POLICY.md is normative: deterministic work in code at $0;
  Spark 1.3 Standard, low effort, cached prefixes for volume reasoning;
  Contributor for evaluation and synthetic data only — never personal
  data; Wonder is banned from volume paths.
- Every model call is written to a cost ledger. A global daily ceiling
  ($10) stops model spend. Per-user spend caps are required before
  public registration opens; they are not yet built.
- api/meta_client.py is the only module that calls the Model API. The
  personal-data rule is enforced there by construction.

## 11. Deployment

- One Oracle VM (Always Free; no new cloud resources). Docker Compose:
  Postgres, the API, Caddy with Let's Encrypt. Public name:
  arya-pilot.duckdns.org, with a DuckDNS updater on the VM.
- Deploy is `git pull` on the VM, then a compose rebuild. Never
  rsync --delete: it once deleted the VM-only deploy environment.
- Tests (59) run before every commit. Small commits to main, named by
  stage; a session log goes to loops/ and STATUS.md is updated.

## 12. Not built / held

- Per-user spend caps (§10) — required before registration opens.
- Public registration — closed. The plan: open after the hackathon,
  with a clear notice that Muse is the only way in.
- Stage 5, the store guidance add-on — held by the owner. It does not
  gate the core.
- Forgot-password — not built. There is no mail channel; a fake
  affordance was refused on principle.
