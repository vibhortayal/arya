# Meta products used, and how

Every intelligent step in Arya Quest runs on a Meta model. Commodity tooling (Three.js, ffmpeg, Postgres) does plumbing only — no non-Meta AI touches perception, reconstruction, or judgment.

| Meta product | Job in Arya Quest | Where it runs |
|---|---|---|
| **VGGT / VGGT-Ω** (Meta AI + Oxford VGG; CVPR 2025 Best Paper) | Store geometry: walkthrough video frames → camera poses, depth maps, dense point cloud of the real store | Mapping pipeline (platform plane) |
| **SAM 3.1** | Product segmentation: cut individual products out of shelf frames so items can be placed on the shelf graph | Mapping pipeline |
| **Muse Spark** (vision, via the user's own Muse + the Arya connector) | Edge perception: read handwritten lists and whiteboards, shelf labels and price cards, fridge/pantry photos (Eyes), receipt photos | User's Muse session; structured output only reaches Arya |
| **Muse Spark 1.3 Standard** (Meta Model API) | Server judgment: the staple judge (what belongs on the list), the Curator (product identity merges), hunt narration in Ask Arya, order-text extraction fallback | Arya engine on our server |
| **Meta Model API** (api.meta.ai) | The single surface for all server-side model calls — one client module, per-account tokens, daily spend ceiling | Arya engine |

## Rules we hold

- **Personal data is Standard-only.** The Contributor tier may train on inputs; real household data (receipts, lists, photos) never goes there. Contributor is for eval and synthetic fixtures.
- **Verification over trust.** Model output is a proposal: receipt totals must reconcile arithmetically, low-confidence lines queue for human review, identity changes (Curator merges) apply only on user approval.
- **Most cost-efficient model per job.** Deterministic code first ($0), Spark 1.3 Standard low-effort with cached prefixes for judgment, frontier models banned from volume paths.

## Models considered and not used

- **Wonder 1.0** — frontier tier; no job in the product has failed on Spark twice, which is our bar for reaching for it.
- Third-party vision/reconstruction (COLMAP pipelines, hosted splat services) — VGGT covers reconstruction as a Meta model and skips the classical pipeline entirely; using a non-Meta reconstructor would spend the hackathon's core claim (Meta tooling) for no gain.
