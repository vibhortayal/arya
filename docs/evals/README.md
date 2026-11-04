# Evidence behind the measured results

Every number in the repo README's "Measured results" has a file here.

| Claim | File |
|---|---|
| Gate 0: 90 of 98 lines on 9 public receipt photos (Spark), arithmetic 7 of 7 | [GATE-0-REPORT.md](GATE-0-REPORT.md) |
| Wonder 97 of 98 vs Spark 92 of 98 on the same set (Wonder after hand adjudication; Spark on the automatic scorer, which gives Wonder 86 of 98), latency and cost | [WONDER-EVAL.md](WONDER-EVAL.md) |
| Staple judge precision 0.79 (41 of 52) against a cadence proxy | [JUDGE-EVAL.md](JUDGE-EVAL.md) |

Read the numbers as a gap, not a score: Spark scored 90 of 98 in the Gate 0 run and 92 of 98 in the Wonder comparison on the same set, which is run-to-run variance on one small set, so quote the difference between the models rather than either number alone. The live reader (`auto`: Spark first, Wonder re-reads a flagged receipt) is not yet measured on photos; a swapped pair of prices keeps the sum, so the review queue stays. On the sample receipt in the judge playbook, three live runs on 2026-11-02 matched every printed price; one of them was re-read by Muse Wonder.

`gate0-public-set/` holds the hand labels (written before any decode), the raw
model results, the scores, the two scripts (`decode_public.py`, `score_public.py`)
and `manifest.json` with each photo's public source. The photos themselves are
not copied here because they belong to their publishers; `manifest.json` links
each one.

The scripts and reports were written in a separate workspace, so paths such as
`~/workspace/meta-hackathon-2026/` in them point there, not into this repo.
The reports are dated records; the app has changed since.
