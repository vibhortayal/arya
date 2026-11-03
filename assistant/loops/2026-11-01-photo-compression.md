# 2026-11-01 Photo compression before upload

Owner's group test: a receipt photo said "photo too large". `web/src/lib/photo.ts` `fitPhoto` redraws big or HEIC photos as JPEG at up to 6 MP (long side ≤ 4096 px, quality 0.85) before upload; PDFs, small JPEG/PNG/WebP and anything the browser cannot draw go up unchanged. It tries createImageBitmap, then an <img> (HEIC on Safari).

Used by: receipt photo (AddReceiptSheet decode), the background batch (receiptJobs), the trip receipt (haul decodeAny), Ask photo (shrinkPhoto fallback and expiry/eyes posts), list from photo (Lists, NewList), expiry photo (Today).

Tests: src/lib/photo.test.ts. Web suite: only the known flaky pack.test.tsx arrow-key test.
