# Meta products used, and how

Every intelligent step in Arya Quest runs on a Meta model. Commodity tooling (Three.js, ffmpeg, Postgres) does plumbing only — no non-Meta AI touches perception, reconstruction, or judgment.

| Meta product | Job in Arya Quest | Where it runs |
|---|---|---|
| **VGGT / VGGT-Ω** (Meta AI + Oxford VGG; CVPR 2025 Best Paper) | Store geometry: walkthrough video frames → camera poses, depth maps, dense point cloud of the real store | Mapping pipeline (platform plane) |
| **SAM 3.1** | Product segmentation: cut individual products out of shelf frames so items can be placed on the shelf graph; the same segmenter powers Shelf Scan — in an unmapped store the camera proposes the shelf regions that hold list items | Mapping pipeline; Shelf Scan on the server |
| **Muse Spark** (vision, via the user's own Muse + the Arya connector) | Edge perception: read handwritten lists and whiteboards, shelf labels and price cards, fridge/pantry photos (Eyes), receipt photos | User's Muse session; structured output only reaches Arya |
| **Muse Spark 1.3 Standard** (Meta Model API) | Server judgment: the staple judge (what belongs on the list), the Curator (product identity merges), hunt narration in Ask Arya, order-text extraction fallback, Shelf Scan crop verification, and the fallback reader for receipt photos | Arya engine on our server |
| **Muse Wonder 1.0** (Meta Model API) | Two jobs, both earned by measurement. (1) Receipt photo decode: on the Gate 0 public set Wonder scored 98.98% identity+price against Spark's 93.88%, with zero price errors — it reads the price rotation Spark missed (WONDER-EVAL.md, research repo). A 90-second timeout falls back to Spark, and the receipt records which model read it. (2) Software authorship: Wonder wrote the in-store localizer — the SIFT matcher behind "Where am I?", which placed 42 of 45 held-out photos at the right stop and runs locally, with no API call | Arya engine (decode); localizer runs on the server, authored once |
| **Muse Image 1.0** (Meta Model API) | Game art: the 20 collect-celebration characters (one per item or category) shown when an item is collected in Quest mode | Generated once, shipped as app assets |
| **Muse Voice Transcribe** (Meta Model API) | The list voice door and the Ask Arya microphone: speech becomes text the user can edit before anything is filed | Arya engine on our server |
| **Meta Model API** (api.meta.ai) | The single surface for all server-side model calls — one client module, per-account tokens, daily spend ceiling | Arya engine |

## Rules we hold

- **Personal data is Standard-only.** The Contributor tier may train on inputs; real household data (receipts, lists, photos) never goes there. Contributor is for eval and synthetic fixtures.
- **Verification over trust.** Model output is a proposal: receipt totals must reconcile arithmetically, low-confidence lines queue for human review, identity changes (Curator merges) apply only on user approval.
- **Most cost-efficient model per job.** Deterministic code first ($0), Spark 1.3 Standard low-effort with cached prefixes for judgment. Frontier models are banned from volume paths unless a scored eval moves the job — receipt photo decode is the one exception, it is time-boxed to the hackathon amendment (expires Nov 4), and it carries a Spark fallback.

## Models considered and not used

- **Muse Spark Open / Muse Glimmer** (open weights) — not yet run. One real job on an open-weights model (the staple-judge batch or shelf matching, served from Modal) is the open tooling item; it closes only on a scored run, not a token call.
- **Gaussian splatting** — tested as a store view and rejected for the submission: the splat collapses in the mid and late aisles because the walkthrough poses drift (VERDICT.md in the spike record). The shipped store views are the photo-walk (default) and the VGGT point cloud.
- Third-party vision/reconstruction (COLMAP pipelines, hosted splat services) — VGGT covers reconstruction as a Meta model and skips the classical pipeline entirely; using a non-Meta reconstructor would spend the hackathon's core claim (Meta tooling) for no gain.
