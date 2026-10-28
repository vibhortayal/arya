# 2026-10-28 — open weights: enrichment + judge second seat

- api/open_client.py: Baseten client in MetaClient's shape; refuses
  personal=True; env BASETEN_API_KEY + ARYA_OPEN_MODEL (default
  meta-models/muse-spark-open-1026 — the partner key answers only
  that slug, verified via the custom.baseten connector).
- api/dictionary/enrich.py: fills category + section_guess on entries
  with category None; Spark Open proposes, hosted Spark arbitrates
  <0.7 confidence; provenance label_by/label_conf stamped.
  label_corpus_agreement() is the eval harness.
- api/judge.py: second_seat_batch (prompts/staple_judge_names_v1.md)
  + second_seat_report; POST /api/judge/second-seat runs it over an
  account's judged items (names only) and stores the report in
  second_seat.json. Spark's facts verdict remains the decider.
- harness/open_batch.py: agreement | enrich | seat over a names file.
- Live (Hatch, connector surrogate, public 32-name corpus): labels
  32/32 (conf 0.88-1.0; meat lands category "other" + section
  "meat & seafood" — no meat cast category exists), seat 32/32.
- OPEN: agreement % vs hosted Spark needs MODEL_API_KEY beside the
  Baseten key — run harness.open_batch agreement on the VM after the
  owner adds BASETEN_API_KEY to assistant/deploy/.env. Production
  routes stay inert until then (OpenClient raises a clear error).
- Suite 502 OK (8 new in tests/test_open_weights.py).
