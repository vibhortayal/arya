# Meta products used, and how

Every intelligent step runs on a Meta model. Other tooling (Three.js,
ffmpeg, Postgres) does plumbing only.

| Meta product | Job | Where |
| --- | --- | --- |
| **SAM 3.1** | Shelf segmentation for the store map; Shelf Scan and Find it for me boxes; finding people so they are blurred before any frame is kept | Mapping pipeline; server |
| **Muse Spark 1.3 Standard** | Staple judge, Curator, Ask Arya, list photos, order-text fallback, shelf labels, Shelf Scan crop verification, receipt fallback | Server (Meta Model API) |
| **Muse Spark** (user's own Muse + connector) | Edge perception: lists, fridge photos, receipts from chat | The user's Muse session |
| **Muse Wonder 1.0** | (1) Receipt photo decode: 97/98 lines after adjudication vs Spark 92/98, zero price errors; 90 s timeout to Spark. (2) Authored the "Where am I?" localizer (42/45 held-out frames at the right stop; runs locally, no API call) | Server |
| **Muse Image 1.0** | The 20 grab-celebration characters | Generated once, shipped as assets |
| **Muse Voice Transcribe** | The list mic and Ask Arya's mic | Server |
| **VGGT** (Meta AI research; not on the event list, so it supports rather than leads) | Store geometry from walkthrough frames | Mapping pipeline |
| **Meta Model API** | The one surface for server calls, through one client module with a daily spend ceiling | Server |

## Rules
- Personal data is Standard-only; Contributor mode is eval and
  synthetic data only.
- Model output is a proposal: receipts must reconcile, low-confidence
  lines queue for review, identity changes need the user's approval.
- Cheapest model that holds the score. Wonder on receipt decode is the
  one exception, time-boxed to the hackathon amendment (expires Nov 4).
- No pictures of people kept: SAM blurs them first, or the frame is
  dropped.

## Considered, not used
- **Spark Open / Glimmer** (open weights): not run yet; we do not
  claim that bonus.
- **Gaussian splatting:** rejected; the splat collapses where the walk
  poses drift. Photos and the VGGT cloud ship instead.
- Non-Meta reconstruction: VGGT covers it.
