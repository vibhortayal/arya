# Meta models: available, used, and future ideas

A one-time look (2026-11-02) at every model Meta offered us, what Arya uses
today, and what it could use later. Used models are described in detail in
[`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md) and
[`docs/quest/META-PRODUCTS.md`](quest/META-PRODUCTS.md); this page adds the
models we did **not** use. The model list comes from Meta's models page
(dev.meta.ai/docs/models) as read on 2026-11-02, and the code from
`assistant/api/meta_client.py`. Where I could not confirm something, it says
"unconfirmed". Everything under "Future" is an idea, not built and not promised.

## Used today

| Model | Id | Where in Arya |
|---|---|---|
| Muse Spark 1.3 (Standard) | `muse-spark-1.3` | Receipt photos first, staple judge, Curator, Ask Arya, list and date photos, shelf labels |
| Muse Wonder 1.0 | `muse-wonder-1.0` | Re-reads a receipt the checks flag, or when Spark fails |
| SAM 3.1 | `sam-3.1` | Shelves, signs, Find it for me boxes, blurring people |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | List mic and Ask Arya mic |
| Muse Image 1.0 | `muse-image-1.0` | The 20 celebration characters, generated once |
| Muse Spark Open (open weights) | hosted on Baseten | Second seat of the staple judge, dictionary labels; never sees personal data |

## Available but not used

| Model | What it is | Fit for Arya | Cost and effort |
|---|---|---|---|
| **Spark 1.3 Contributor** (`muse-spark-1.3-contributor`) | Same model on a lower-price tier with different data terms (see Meta's models page) | Cuts AI cost by roughly 10x on input and 20x on output (list prices: $0.10 / $0.20 vs $1.25 / $4.25 per 1M tokens). The code supports it (`ARYA_SPARK_TIER`), but Arya runs Standard on purpose. **Future idea:** a community tier where a user opts in, for non-personal jobs only | Needs an opt-in screen, routing rule and privacy text first. Rate limit 150 requests/min vs 3,000 on Standard, which also caps scale |
| **Muse Glimmer** (open weights) | 30B dense, text and image in, text out, Apache 2.0, distilled from Spark; runs on your own hardware via vLLM, SGLang, llama.cpp, Ollama | **Future idea:** a self-hosted "household stays at home" reader, or a cheap pre-filter before Spark for name cleanup and labels. Text and image only, so no audio or PDF. Accuracy on receipts is **not measured** by us | No per-token price from Meta; we would pay for a GPU or a host. Whether Baseten serves it is unconfirmed. Needs its own eval against the 98-line receipt set before any job moves |
| **Muse Spark 1.2 / 1.1** | Older Spark versions. Meta recommends 1.2 for audio input | Not needed: we send audio to Voice Transcribe | None |
| **Muse Wonder Full** | Higher Wonder variant | Muse Code plans only, not on the Model API, so unavailable to the app | n/a |
| **Muse Code** | Meta's coding agent (CLI) | Could help build, not a runtime part of Arya. Not used | n/a |

Smaller API features we have not used: web-search grounding ($2.50 per 1,000
searches; could ground "is this a good price" but would send queries out,
so it conflicts with the personal-data rule), computer use (no fit), and the
Files API with background responses (a possible fit for very long scan videos).
Image generation is only used offline for the characters; a live "dinner
render" idea sits in MODEL-POLICY and is not built.

## Challenge: store video and photos we cannot use

The best raw material for better store maps and shelf help already exists
online: walkthrough videos and in-store photos on YouTube, TikTok and similar
sites. Arya cannot use them. They belong to their creators and the platforms,
the platform terms forbid bulk collection, and Arya's own rule is that no
store map is built from footage we do not have the right to use (the
Trader Joe's walkthrough experiment was removed for exactly this reason; see
`docs/quest/META-PRODUCTS.md`). Today every store map comes from a shopper
walking their own store with the guided scan.

**Future idea: a data partnership.** A store chain, a licensed-content
provider or a platform that can legally supply in-store video and photos
(aisle walkthroughs, shelf signs, layout) would let Arya:
- start each store with a first map instead of an empty one;
- test and tune the shelf-reading step (SAM plus Spark) on many layouts, not
  one household's;
- give community shoppers better "where is it" help from day one.

Any partnership would need written permission, store consent, the existing
people-blurring rule, and a takedown route. See
[`docs/ROADMAP.md`](ROADMAP.md) ("Store data and community").

## Consistency notes
Spark and Wonder run in Standard mode (owner decision, 2026-11-01). Nothing
here changes that. The JUDGES.md line "Not used, said plainly: Muse Glimmer
and Muse Code" stays true.
