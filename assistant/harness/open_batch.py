"""Open-weights batch jobs (owner, 2026-10-28).

Runs the Muse Spark Open jobs from the command line, over a names
file (one item name per line — golden fixtures, the demo household,
platform sightings; never a per-owner export):

  python -m harness.open_batch agreement --names names.txt
      The eval: Spark Open and hosted Spark label the same names;
      prints the agreement report (the submission number).

  python -m harness.open_batch enrich --names names.txt --out labels.json
      Labels with Spark Open; low-confidence rows are arbitrated by
      hosted Spark. Writes {name: {category, section, confidence,
      label_by}} as JSON.

  python -m harness.open_batch seat --names names.txt
      The judge's second seat, name-only verdicts, printed as JSON.

Needs BASETEN_API_KEY (Spark Open) and MODEL_API_KEY (hosted Spark)
in the environment. Personal data is refused by construction: the
open client raises on personal=True and these jobs send names only.
"""
import argparse
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 2)[0])

from api.dictionary.enrich import label_corpus_agreement, label_names
from api.judge import second_seat_batch
from api.meta_client import MetaClient
from api.open_client import OpenClient


def _names(path):
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="open_batch")
    ap.add_argument("job", choices=["agreement", "enrich", "seat"])
    ap.add_argument("--names", required=True)
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    names = _names(args.names)
    open_client = OpenClient()
    if args.job == "agreement":
        report = label_corpus_agreement(open_client, MetaClient(), names)
        print(json.dumps(report, indent=1))
    elif args.job == "enrich":
        labels = label_names(open_client, names)
        weak = [n for n in names
                if n not in labels or labels[n]["confidence"] < 0.7]
        if weak:
            hosted = label_names(MetaClient(), weak)
            for n, lab in hosted.items():
                labels[n] = {**lab, "label_by": "spark-arbiter"}
        for lab in labels.values():
            lab.setdefault("label_by", "spark-open")
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(labels, f, indent=1)
        print(f"labeled {len(labels)}/{len(names)} "
              f"(arbitrated {len(weak)})")
    else:
        pairs = [(f"n{i}", n) for i, n in enumerate(names)]
        verdicts = {}
        for i in range(0, len(pairs), 25):
            verdicts.update(
                second_seat_batch(open_client, pairs[i:i + 25]))
        out = {names[int(iid[1:])]: v for iid, v in verdicts.items()}
        print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
