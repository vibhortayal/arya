# Photo decode flips to Wonder — Spark fallback behind it (2026-10-27)

Implements the MODEL-POLICY hackathon amendment (through
2026-11-04): judge-facing PHOTO decode reads with Muse Wonder 1.0.
The staple judge, Ask Arya, PDF/text decode, order-text decode,
Shelf Scan verify, and the list-photo classification do not change;
they stay on Spark Standard.

## What changed

- `api/decode/service.py` — `decode_photo` attempts Wonder first
  (`mode="wonder"`, `personal=True`, no reasoning_effort key —
  Wonder's production configuration in WONDER-EVAL), bounded at
  `PHOTO_WONDER_TIMEOUT_S = 90` s. The bound is the eval's p95
  (60.5 s) plus headroom. Any failure — timeout, HTTP error,
  unparseable output — falls back to Spark Standard at its previous
  production configuration, for the same photo. The receipt records
  the reader in a new field, `decoded_by` (`muse-wonder-1.0` or
  `muse-spark-1.3`), so a fallback is visible in the record, never
  silent. `_photo_read` holds the shared call+parse so both attempts
  build the receipt identically.
- `api/meta_client.py` — `chat()` gains a `timeout` argument
  (seconds; None keeps the 120 s default) passed to the HTTP call,
  and `reasoning_effort=None` now omits the key from the request
  body. All other callers keep the previous defaults. Ledger
  recording is unchanged: Wonder calls record at Wonder prices
  (PRICES already carried them).
- Client wait copy — the decode wait is now ~30 s typical, up to
  the 90 s bound. The three `/decode/photo` flows state it plainly,
  with no progress bar: "Reading the receipt — this can take up to
  a minute." (`fileReceiptPhoto`, the hunt finish, and the late
  receipt upload, which previously had no wait state at all.) The
  list-photo read keeps its Spark wording; that path did not flip.
  Service worker cache: arya-v30.

## Unit verification

267 tests green (260 at HEAD + 7 new). New pins: Wonder is the
photo reader (mode, personal, no-effort, 90 s bound asserted on the
recorded call); a Wonder timeout, a Wonder HTTP error, and Wonder
garbage output each complete the same photo via Spark with
`decoded_by = muse-spark-1.3`; text decode carries no `decoded_by`
(scope pin); the client's Wonder request shape omits
reasoning_effort; the timeout reaches urlopen (90 s set, 120 s
default). The existing photo tests now assert the Wonder contract.

## Live proof — Gate 0 public set through the production path

Runner: `~/workspace/arya-eval/flip_run.py` (the 9 public photos
through the real `decode_photo` + `MetaClient`; results in
`~/workspace/arya-eval/flip-results/`). Scorer:
`~/workspace/arya-eval/flip_score.py`, driving the eval's own
`wonder_score.py`. One repair, in the harness only: the scorer's
difflib alignment branch crashes on label files that carry
`{"unreadable": ...}` placeholder lines when the decoded count
differs from the label-entry count (this run's pub-09: 16 decoded
vs 15 entries). The eval never took that branch — its counts
matched on every receipt. The harness substitutes "" for the
placeholders' product string in that branch; no scoring rule
changed.

All 9 receipts read by Wonder (`decoded_by = muse-wonder-1.0`);
no fallback fired. Latency: mean 29.2 s, max 59.9 s (pub-09) —
inside the 90 s bound. Spend, from the run's CostLedger:
**$1.1177** for 9 calls (mean $0.124 per receipt; the eval's
Wonder run: $0.118).

Scores, identity+price, the eval's two columns:

| Column | This run | WONDER-EVAL (Wonder) |
|---|---|---|
| Automatic scorer | 87/98 = 88.78% | 86/98 = 87.76% |
| Hand-adjudicated | **97/98 = 98.98%** | **97/98 = 98.98%** |
| Price errors | 0 | 0 |
| Arithmetic | 7/7 | 7/7 |

Adjudication, per line, under the eval's written rulings: the 11
automatic failures are the eval's own classes — brand expansions
(LNF → Light & Fit, pub-01; PF → Pepperidge Farm, KB → Keebler +
Cookies, OS → Ocean Spray, pub-08), the HEB → H-E-B hyphenation
(five pub-03 lines, incl. idx11, whose promo detail text Gate 0
hand-scored correct on the identical read), and the StarKist Tuna
completion (pub-08 idx10; the Ocean Spray "Juice" completion is
the same borderline class — both ruled correct, as in the eval).
The one surviving error is the eval's own shared error: pub-04
idx21, "M&M 15%FREE 1884" read as "18&4" — a digit misread both
models make. pub-05, the price-rotation receipt: 13/13, zero
price errors. One finding the eval's scored run did not have:
pub-09 emitted one extra line (16 decoded vs 15 label entries);
the scorer counts it under extra_line, outside the 98-line
identity denominator. On a real receipt that line lands in the
review queue like any unverified read.

## Expiry

The amendment expires **Nov 4, 2026**. After that date photo
decode must return to Spark Standard unless the owner extends
the amendment in MODEL-POLICY.md. `decoded_by` stays either way —
it is how the record shows which reader a receipt had.
