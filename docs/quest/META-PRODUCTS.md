# Meta products used, and how

Every intelligent step runs on a Meta model. Other tooling (Three.js,
ffmpeg, Postgres) does plumbing only.

| Meta product | Job | Where |
| --- | --- | --- |
| **SAM 3.1** | Shelf segmentation for the store map; Shelf Scan and Find it for me boxes; finding people so they are pixelated before any frame is kept | Mapping pipeline; server |
| **Muse Spark 1.3 Standard** | Staple judge, Curator, Ask Arya, list photos, expiry-date photos, grocery check for unknown names, order-text fallback, shelf labels, Shelf Scan crop verification, receipt fallback | Server (Meta Model API) |
| **Muse Spark Open** (open weights, hosted on Baseten) | Second seat of the staple judge (names only, advisory) and dictionary category labels. It sees item names only (no prices, dates, stores or account details). Numbers: [JUDGES.md](../../JUDGES.md#which-model-does-which-job) | Batch jobs (`api/open_client.py`) |
| **Muse, the user's own assistant (over MCP)** | Connects to Arya as an agent: reads the list, adds and checks off items, answers "what am I running low on?", and files a receipt it read in chat (Arya checks the arithmetic) | The user's Muse session, to Arya's MCP address (live) |
| **Muse Wonder 1.0** | (1) Second reader for receipt photos (rule: see the model map). Numbers: [JUDGES.md](../../JUDGES.md#which-model-does-which-job). | Server |
| **Muse Image 1.0** | The 23 grab-celebration characters; share looks | Characters generated once and shipped as assets; share looks are generated live per tap |
| **Muse Voice Transcribe** | The list mic and Ask Arya's mic | Server |
| **Meta Model API** | The one surface for server calls, through one client module with a daily spend ceiling | Server |

## Muse connects to Arya (live)
Arya has a standard MCP connector, and Muse is the reference client. In Muse, ask the agent to connect to Arya's MCP address. When it asks for your code, paste it into the secure credentials vault Muse opens, never into the chat. I tested exactly that on my own Muse on 2026-11-02, with no terminal and no settings file. Muse then has six tools: `get_snapshot`, `get_list`, `add_items`, `check_item`, `file_receipt` and `get_receipts`. A receipt Muse reads in chat is filed through `file_receipt`. Arya checks the arithmetic itself and spends no photo-reading credits on it. The code acts as your account, but it cannot reach routes that spend model credits in bulk, change settings, or touch groups and friends. It is capped at 600 calls an hour, and you can turn it off in Arya at any time. Setup and limits: [the agent connector](../../assistant/docs/AGENT-CONNECTOR.md).

## Rules
- Spark and Wonder run in Standard mode (checked 2026-11-01): content is not used to train Meta models. Contributor
  is used for eval and synthetic data only; a community Contributor tier with user opt-in is a possible later option, not built.
- Model output is a proposal. Receipts must reconcile, low-confidence
  lines queue for review, and identity changes need the user's approval.
- Cheapest model that holds the score. Wonder as the backup receipt reader is
  the one exception, time-boxed to the hackathon amendment (expires Nov 9).
- No pictures of people are kept. SAM pixelates the people it detects first, or the frame is
  dropped.

**Used to build, not shipped.** Muse Code (Meta's coding agent), running Muse Wonder, wrote the first version of the engine (my account). It is not part of the shipped app; see the README, How this was built.

## Considered, not used
- **Glimmer** (open weights): not run.
- **Gaussian splatting and VGGT 3D models:** tried on a Trader Joe's
  walkthrough during the hackathon, then removed (2026-10-29). The
  store the video came from was never recorded, so it could not be
  any real store's map.
