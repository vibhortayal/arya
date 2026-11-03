# 2026-11-03 Demo receipt: Spark's read first, Wonder's second read on screen

Owner approved the mockup (claude.ai/artifact/4UTn4g2Q8PDdcSCB54yrms), "do this change in demo only": "it will show what we say in docs, spark primary, wonder secondary".

- `api/decode/service.py`: `_decode_auto` split into `_spark_first` + `_second_read` (same behavior); new `decode_photo_spark_first` for the demo returns Spark's flagged read plus a callable for Wonder's read.
- `api/decode/second_read.py` (new): the Wonder read runs in a thread with the visitor's context copied; the outcome (pending, changed, same, failed) is held in process memory only, bound to the visitor's sandbox, forgotten after 10 minutes. The first poll after Wonder finishes swaps the receipt in the visitor's sandbox.
- `/decode/photo` (demo only) returns `check: {id, reasons}` when the checks flag Spark's read; `GET /decode/check/{id}` (demo only) answers the state. Signed-in accounts are unchanged (background reads).
- `Receipts.tsx`: the status note per the mockup, Add receipts shows "Checking…" while Wonder reads, changed rows tinted with "Changed" and "Spark read <old>", "Read by" names the model; polls every 3 s, gives up at 90 s.
- Help receipts n5, Ask knowledge line (trimmed two receipts sentences to stay under 26,000).
- Tests: tests/test_demo_second_read.py (12), web secondread.test.tsx (5).
