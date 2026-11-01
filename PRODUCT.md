# PRODUCT — Arya

Derived from the owner's approved brief (assistant/docs/SPEC.md and
VISION.md), 2026-10-27. Where this file and the spec disagree, the spec wins.

## What it is

Arya is a grocery list that learns: Waze for grocery shopping. The list is
the product. Arya keeps a living model of one household's purchases: every
receipt is read and checked, every return is netted, and buying patterns are
learned. The shopping list writes itself from that model: what is running
low, what to use soon, and where it is usually bought.

Quest is the second layer, and it is optional. It is its own tab, for when
shopping should feel like play: a hunt through a model of the shopper's
store that ends on a receipt photo. Shared households (Groups) let several
people keep one set of lists.

## Who uses it

One household, or a few people sharing one home (a Group). The primary user shops mainly at Costco and buys on a
repeat rhythm. The user opens Arya on a phone, often one-handed, often in
or near a store. Speed and trust matter more than features.

## The job

- Show what is running low, and why, in seconds.
- Keep a list the user can edit with one tap: add, remove, change
  quantity, check off while shopping.
- Record a receipt from one photo or PDF. Show that the total was checked.
- Answer questions about the household's food and spending, by text or
  voice, and act on simple statements ("we finished the yogurt").
- Never suggest an item without a reason the user can inspect.

## Trust rules (product truth, not style)

- Precision over recall. An unnecessary suggestion annoys; a missed one
  costs one tap. Unjudged and unresolved items stay off the list.
- A reasoning model (the staple judge) decides what kind of thing an item
  is. Deterministic code reports the facts and the timing.
- Explicit user intent always beats the model.
- Unseen is unknown. Arya never guesses a product name or a sighting.
- Nothing buys itself. Arya sends no order and makes no payment.
- Prices come from the household's own receipts, never from store sites,
  flyers, APIs or the web.

## Surface

A phone-first PWA with five tabs: Today, Lists, Ask, Quest, Settings. Mode: Operate. The user is completing a task, not
reading marketing. The visual language follows the Apple UI design system for
type and layout: system typography, grouped lists, 44 pt targets. Color is
greyscale structure with one orange accent, light mode only (`DESIGN.md`). One account, the owner's; judges of the hackathon use a
read-only demo household with fictional data.

## Constraints

- Meta models only for model work; Spark and Wonder run in Meta's Standard mode (not used for training; owner decision 2026-11-01).
- Deterministic code for math, patterns, and list logic ($0).
- Submission deadline: Nov 4, 2026, 9:00 PM ET (Meta Global AI Developer
  Hackathon, Team Nightshift, Indie track).
