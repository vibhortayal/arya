# Meta products used, and how

Every intelligent step runs on a Meta model. Other tooling (Three.js,
ffmpeg, Postgres) does plumbing only.

| Meta product | Job | Where |
| --- | --- | --- |
| **SAM 3.1** | Shelf segmentation for the store map; Shelf Scan and Find it for me boxes; finding people so they are pixelated before any frame is kept | Mapping pipeline; server |
| **Muse Spark 1.3 Standard** | Staple judge, Curator, Ask Arya, list photos, expiry-date photos, grocery check for unknown names, order-text fallback, shelf labels, Shelf Scan crop verification, receipt fallback | Server (Meta Model API) |
| **Muse Spark Open** (open weights, hosted on Baseten) | Second seat of the staple judge (names only, advisory) and dictionary category labels. It sees item names only (no prices, dates, stores or account details). Numbers: [JUDGES.md](../../JUDGES.md#meta-model-map) | Batch jobs (`api/open_client.py`) |
| **Muse Spark** (user's own Muse + connector) | Edge perception: lists, receipts from chat | The user's Muse session |
| **Muse Wonder 1.0** | (1) Second reader for receipt photos: re-reads when Spark fails or the checks flag the read (me, 2026-11-01). Numbers: [JUDGES.md](../../JUDGES.md#meta-model-map). | Server |
| **Muse Image 1.0** | The 23 grab-celebration characters; share looks | Characters generated once and shipped as assets; share looks are generated live per tap |
| **Muse Voice Transcribe** | The list mic and Ask Arya's mic | Server |
| **Meta Model API** | The one surface for server calls, through one client module with a daily spend ceiling | Server |

## Rules
- Spark and Wonder run in Standard mode (me, 2026-11-01): content is not used to train Meta models. Contributor
  is used for eval and synthetic data only; a community Contributor tier with user opt-in is a possible later option, not built.
- Model output is a proposal: receipts must reconcile, low-confidence
  lines queue for review, identity changes need the user's approval.
- Cheapest model that holds the score. Wonder as the backup receipt reader is
  the one exception, time-boxed to the hackathon amendment (expires Nov 9).
- No pictures of people kept: SAM pixelates the people it detects first, or the frame is
  dropped.

## Considered, not used
- **Muse Code** (Meta's coding agent): not used in the shipped app; see the README, How this was built.
- **Glimmer** (open weights): not run.
- **Gaussian splatting and VGGT 3D models:** tried on a Trader Joe's
  walkthrough during the hackathon, then removed (2026-10-29): the
  store the video came from was never recorded, so it could not be
  any real store's map.
