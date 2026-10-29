# 2026-10-29 · Receipt upload fix (owner: "getting error when uploading the costco receipt pdfs. test and fix")

## The bug
Owner uploads a Costco PDF on the Receipts screen from his phone:
"Could not read that photo: empty upload". Server-side is healthy —
the same PDF posted with curl decodes and files perfectly. The body
arrived EMPTY from the browser: the service worker's fetch handler
mediated every request (BYPASS paths included, via
respondWith(fetch(request))), and a worker-forwarded POST body is
an empty-body failure class on iOS.

Fix: sw.js returns early for any non-GET request — writes and
uploads use the browser's own stack, untouched. The worker only
shells GET reads. Client also guards a genuinely empty file with a
human message ("still downloading?") instead of a server 400, and
says "file" not "photo" for PDFs.

## Duplicates (owner: "what happens if user adds duplicate receipts?")
Before: nothing — each decode mints a fresh receipt_id, so the
same receipt filed twice counted the trip twice in patterns and
spend. Now a receipt has a content fingerprint (merchant + date +
lines + total). add_receipts skips an uploaded original (media)
whose fingerprint is already on file — group members' receipts
included; doors without an upload keep the id-based rule. The
decode doors answer {duplicate: true, receipt: <the record on
file>} so the hunt finish flows settle by the filed receipt's id,
and the Receipts screen says "Already filed — skipped, so the
trip is not counted twice."

## Bulk (owner: "allow option for bulk upload")
The Receipts picker takes several files at once; they file one by
one with a progress line ("Reading 2 of 7 — …") and one summary at
the end: filed / already filed, skipped / could not be read.

SW arya-v87. Tests: test_receipt_dedupe (6) + full suite.
