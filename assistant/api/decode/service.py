"""Decode service — three inputs, one DecodedReceipt contract (§3).

Paths: normalize_costco_json (structured export, $0, no model),
decode_text (PDF text via meta_client, Standard + personal).
Photo decode joins after the Gate 0 verdict.
Post-rules in code: discount lines attach to a parent SKU (named on the
receipt as "/<sku>", else the previous item line) and are always auto —
they are structure, not identity, and never enter the review queue;
status is auto at confidence >= 0.8, else unverified; totals_reconcile
is computed, never taken from the model.
"""
import hashlib
import re, json, os
from datetime import datetime

from api.meta_client import MODELS, parse_json, spark_model


def _iso_day(v):
    """Normalize a source date to ISO YYYY-MM-DD for the store.

    Sources print dates their own way: Costco JSON is ISO, a photo
    read returns what the receipt shows ('07/29/26'). Every consumer
    downstream parses ISO only (patterns, ledger, boards) — a US
    format stored verbatim crashed /api/home and the decode route's
    judge step with ValueError (live, 2026-10-28). Unparseable values
    pass through unchanged; consumers tolerate them (see
    patterns.engine._d)."""
    if not v:
        return v
    s = str(v).strip()
    try:
        return datetime.fromisoformat(s).strftime("%Y-%m-%d")
    except ValueError:
        pass
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # A date with the time after it, or glued onto it: Costco prints
    # "04/26/202416:23" and "P7 04/26/2024 03:58". Take the day only.
    for rx in _US_DAYS:
        m = rx.search(s)
        if m:
            try:
                return datetime.strptime("/".join(m.groups()), "%m/%d/%Y" if len(m.group(3)) == 4 else "%m/%d/%y").strftime("%Y-%m-%d")
            except ValueError:
                continue
    return v


# 4-digit year first (may run straight into a clock time), then 2-digit.
_US_DAYS = (re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(20\d{2})"),
            re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{2})(?!\d)"))

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "decode_v2.md")
AUTO_THRESHOLD = 0.8


# Receipt-shaped output for the text paths. Loose on purpose: the
# arithmetic in _finish() is the real validator, the schema only keeps
# the model on a JSON object with a lines array.
RECEIPT_SCHEMA = ("DecodedReceipt", {
    "type": "object",
    "properties": {"merchant": {"type": ["string", "null"]},
                   "purchased_at": {"type": ["string", "null"]},
                   "lines": {"type": "array", "items": {"type": "object"}},
                   "subtotal": {"type": ["number", "null"]}},
    "required": ["lines"]})


HINTS_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "costco_abbreviations.md")


def load_hints():
    """Costco abbreviation hints, appended to every receipt prompt."""
    return open(HINTS_PATH).read().split("\n", 1)[1].strip()


def load_prompt():
    text = open(PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip() + "\n\n" + load_hints()


def _attach_discounts(lines):
    """Record which item a discount belongs to (metadata only). A
    discount line is structural, never a question for the user: it is
    auto-verified in _finish whether its parent was named on the
    receipt ("/<sku>") or inferred from position."""
    last_item_sku = None
    for ln in lines:
        if ln["line_type"] == "item":
            last_item_sku = ln.get("sku")
        elif ln["line_type"] == "discount" and not ln.get("discount_parent_sku"):
            ln["discount_parent_sku"] = last_item_sku
    return lines


def _is_discount(ln):
    return (ln.get("line_type") == "discount"
            or (ln.get("raw") or "").lstrip().startswith("/"))


_RETURN_LABEL = re.compile(r"^\W*(return(ed)?|refund(ed)?|void(ed)?|credit)\b", re.I)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def sign_returns(lines):
    """A return keeps a NEGATIVE amount and quantity (-4.99, -1) wherever
    it is parsed, stored or shown. Readers often print the refund as a
    positive number next to a return/refund/credit/void label, so a
    line labelled that way becomes a return, and a return's amounts and
    quantity are flipped to negative; one that is already negative keeps
    its sign. Discounts are left as they are."""
    for ln in lines:
        if ln.get("line_type", "item") == "item" and _RETURN_LABEL.match(
                ln.get("raw") or ln.get("decoded_name") or ""):
            ln["line_type"] = "return"
        if ln.get("line_type") != "return":
            continue
        for key in ("line_total", "unit_price"):
            if _num(ln.get(key)):
                ln[key] = -abs(ln[key])
        ln["qty"] = -abs(ln["qty"]) if _num(ln.get("qty")) and ln["qty"] else -1
    return lines


def _finish(lines, subtotal):
    sign_returns(lines)
    for ln in lines:
        ln.setdefault("allocation", "HOUSEHOLD")
        ln.setdefault("for_person", None)
        ln.setdefault("item_id", None)
        ln.setdefault("judge_agree", None)
        if _is_discount(ln):
            ln["status"] = "auto"  # structural line; never queued
        elif "status" not in ln:
            ln["status"] = "auto" if (ln.get("confidence") or 0) >= AUTO_THRESHOLD else "unverified"
    lines = _attach_discounts(lines)
    s = round(sum(l["line_total"] for l in lines), 2)
    reconcile = abs(s - float(subtotal)) <= 0.05 if subtotal is not None else False
    return lines, reconcile


def normalize_costco_json(obj):
    """Costco warehouse JSON export -> DecodedReceipt. Pure code, no model."""
    lines = []
    is_refund = obj.get("transactionType") == "Refund"
    last_item_sku = None
    for it in obj.get("itemArray", []):
        amount = float(it["amount"])
        unit = it.get("unit") or 1
        desc = (it.get("itemDescription01") or "").strip()
        # A "/ <number>" line is a coupon/savings line for the item directly
        # above it (its own itemNumber is a coupon SKU). On a refund it is
        # the savings clawback for the returned item above.
        if desc.startswith("/"):
            ltype = "discount"
        elif is_refund:
            ltype = "return"
        elif amount < 0 or "SAVINGS" in desc.upper():
            ltype = "discount"
        else:
            ltype = "item"
        if ltype in ("item", "return"):
            last_item_sku = str(it.get("itemNumber") or "")
        lines.append({
            "raw": desc, "detail": it.get("itemDescription02"), "sku": str(it.get("itemNumber") or ""),
            "decoded_name": "Instant Savings" if ltype == "discount" and desc.startswith("/") else desc,
            "qty": abs(unit),
            "unit_price": round(amount / unit, 2) if unit else amount,
            "line_total": amount, "line_type": ltype,
            "discount_parent_sku": last_item_sku if ltype == "discount" and desc.startswith("/") else None,
            "confidence": 1.0, "status": "auto"})
    lines, reconcile = _finish(lines, obj.get("subTotal"))
    return {"receipt_id": obj.get("transactionBarcode"),
            "source_type": "grocery",
            "merchant": f"Costco {obj.get('warehouseName', '')}".strip(),
            "purchased_at": _iso_day(obj.get("transactionDate")),
            "lines": lines, "subtotal": obj.get("subTotal"),
            "tax": obj.get("taxes"), "total": obj.get("total"),
            "totals_reconcile": reconcile, "image_ref": None}


EXPAND_PROMPT = (
    "You expand abbreviated Costco receipt item names. Input: one line per item, "
    "'[n] PRINTED NAME'. Return ONLY JSON: {\"names\": [{\"n\": int, \"name\": str, "
    "\"confidence\": number 0..1, \"alternatives\": [str]}]}. Expand only when "
    "confident; otherwise keep the printed words, set confidence below 0.8 and give "
    "up to 2 alternatives. Never invent a brand or size not implied by the text.\n\n"
    "Hints:\n")
EXPAND_BATCH = 40
EXPAND_MAX_NAMES = 120
_VOWELS = re.compile(r"[AEIOU]", re.I)


def looks_abbreviated(raw):
    """True for printed names worth a model look: ALL CAPS with a short
    token, a digit-glued token (3PC, 12PK) or a token with no vowels."""
    raw = (raw or "").strip()
    if not raw or raw.startswith("/") or raw.upper() != raw:
        return False
    toks = re.findall(r"[A-Z0-9]+", raw)
    return any(len(t) <= 3 or re.search(r"\d", t) and re.search(r"[A-Z]", t)
               or (len(t) > 3 and not _VOWELS.search(t)) for t in toks)


def expand_costco_names(dec, client, skip_skus=()):
    """Model pass over the abbreviated item lines of a JSON-export receipt
    (they arrive at confidence 1.0 with the printed text as the name).
    Fills decoded_name, confidence, alternatives; below AUTO_THRESHOLD the
    line goes to review. Any failure leaves the receipt exactly as it was.
    Returns the number of lines changed."""
    todo = [ln for ln in dec["lines"]
            if ln["line_type"] == "item" and ln.get("sku") not in skip_skus
            and looks_abbreviated(ln.get("raw"))]
    uniq = list(dict.fromkeys(ln["raw"] for ln in todo))[:EXPAND_MAX_NAMES]
    found = {}
    for i in range(0, len(uniq), EXPAND_BATCH):
        chunk = uniq[i:i + EXPAND_BATCH]
        listing = "\n".join(f"[{n}] {raw}" for n, raw in enumerate(chunk))
        try:
            out, _u, _c = client.chat(
                [{"role": "system", "content": EXPAND_PROMPT + load_hints()},
                 {"role": "user", "content": listing}],
                mode="standard", personal=True, temperature=0.0)
            for v in parse_json(out).get("names", []):
                raw = chunk[int(v["n"])]
                found[raw] = (str(v["name"]).strip(), float(v.get("confidence") or 0),
                              [str(a) for a in (v.get("alternatives") or [])][:2])
        except Exception:
            continue
    changed = 0
    for ln in todo:
        hit = found.get(ln["raw"])
        if not hit or not hit[0]:
            continue
        name, conf, alts = hit
        ln["decoded_name"], ln["confidence"], ln["alternatives"] = name, min(conf, 0.99), alts
        ln["status"] = "auto" if conf >= AUTO_THRESHOLD else "unverified"
        changed += 1
    return changed


def decode_text(text, client):
    """PDF-extracted receipt text -> DecodedReceipt via meta_client.
    Personal data: Standard mode only (enforced in meta_client)."""
    messages = [{"role": "system", "content": load_prompt()},
                {"role": "user", "content": "Decode this receipt text:\n\n" + text}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True,
                                     schema=RECEIPT_SCHEMA,
                                     cache_key="arya-decode-text-v2")
    dec = parse_json(out)
    lines, reconcile = _finish(dec.get("lines", []), dec.get("subtotal"))
    rid = "dec-" + hashlib.sha1(text.encode()).hexdigest()[:10]
    return {"receipt_id": rid, "source_type": "grocery",
            "merchant": dec.get("merchant"), "purchased_at": _iso_day(dec.get("purchased_at")),
            "lines": lines, "subtotal": dec.get("subtotal"), "tax": dec.get("tax"),
            "total": dec.get("total"), "totals_reconcile": reconcile,
            "image_ref": None}


def extract_pdf_text(pdf_bytes):
    """Text layer of a PDF (digital receipts and e-receipts). Scanned PDFs
    without a text layer return little or nothing; the caller refuses those
    until the photo path clears Gate 0."""
    import io
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


PDF_SCAN_MAX_PAGES = 5


def render_pdf_pages(pdf_bytes, max_pages=PDF_SCAN_MAX_PAGES):
    """Scanned PDF -> one JPEG per page, for the photo reader. Raises
    ValueError with a plain message for a locked or oversized PDF."""
    import io
    import pypdfium2 as pdfium
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except pdfium.PdfiumError as e:
        if "password" in str(e).lower():
            raise ValueError("this PDF is password-protected") from e
        raise ValueError("could not read this PDF") from e
    if len(pdf) > max_pages:
        raise ValueError(f"this PDF has {len(pdf)} pages (max {max_pages}) — add the receipt pages as photos instead")
    pages = []
    for i in range(len(pdf)):
        img = pdf[i].render(scale=2.0).to_pil().convert("RGB")
        img.thumbnail((1800, 1800))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        pages.append(buf.getvalue())
    return pages


def decode_scanned_pdf(pdf_bytes, client):
    """A PDF with no text layer (a scan): read each page with the photo
    reader and merge the pages into one receipt. The model proposes,
    arithmetic disposes: totals come from the last page that has them,
    and _finish re-checks the merged lines against the subtotal."""
    recs = [decode_photo(img, client, media_type="image/jpeg", page=True)
            for img in render_pdf_pages(pdf_bytes)]
    first = recs[0]
    lines = [ln for r in recs for ln in r["lines"]]

    def last(key):
        return next((r[key] for r in reversed(recs) if r.get(key) is not None), None)

    subtotal = last("subtotal")
    lines, reconcile = _finish(lines, subtotal)
    first.update({
        "receipt_id": "dec-" + hashlib.sha1(pdf_bytes).hexdigest()[:10],
        "merchant": next((r["merchant"] for r in recs if r.get("merchant")), None),
        "purchased_at": next((r["purchased_at"] for r in recs if r.get("purchased_at")), None),
        "lines": lines, "subtotal": subtotal, "tax": last("tax"),
        "total": last("total"), "totals_reconcile": reconcile})
    return first


PHOTO_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "decode_photo_v1.md")


def load_photo_prompt():
    text = open(PHOTO_PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip() + "\n\n" + load_hints()


# Wonder is the second reader (WONDER-EVAL.md: Gate 0 public photos,
# Wonder 98.98% identity+price vs Spark 93.88%, price errors 0 vs 4).
# Its cost is latency (34.4 s mean / 60.5 s p95 in the eval), so every
# Wonder attempt is bounded at 90 s (p95 plus headroom). With
# ARYA_PHOTO_READER=wonder, ANY Wonder failure (timeout, HTTP error,
# unparseable output) falls back to Spark. The receipt records the
# reader in decoded_by, so a fallback is never silent.
PHOTO_WONDER_TIMEOUT_S = 90


def photo_reader():
    """Which model reads receipt photos. ARYA_PHOTO_READER=auto (the
    default): Muse Spark reads first and Muse Wonder re-reads only a
    receipt the arithmetic checks flag (decode/checks.py). spark: Spark
    only. wonder: Wonder first, Spark if Wonder fails. The owner's Ops
    screen switch (site.json) wins over the environment, with no
    redeploy."""
    from api import site_flags
    v = site_flags.photo_reader() or os.environ.get("ARYA_PHOTO_READER", "auto").strip().lower()
    if v == "auto":
        return "auto"
    return "standard" if v in ("spark", "standard") else "wonder"


def _photo_read(messages, client, **kw):
    out, _usage, _cost = client.chat(messages, personal=True, **kw)
    return parse_json(out)


def _refund_totals(lines, subtotal, tax, total):
    """A refund receipt prints its totals with a trailing minus
    ("107.97-"), which readers often return as a positive number. When
    every line is a return the totals are negative too, so the sum of
    the lines still reconciles with the subtotal."""
    if lines and all(l.get("line_type") == "return" for l in lines):
        def neg(v):
            return -abs(v) if _num(v) else v
        return neg(subtotal), neg(tax), neg(total)
    return subtotal, tax, total


def decode_photo(image_bytes, client, media_type="image/jpeg", page=False):
    """Receipt photo -> DecodedReceipt via meta_client vision.
    Reader: photo_reader() (Spark first, Wonder on a flagged read, by
    default). Spark runs on the tier set by ARYA_SPARK_TIER (Contributor
    by default); MODEL-POLICY.md has the policy and its history.
    Prompt: prompts/decode_photo_v1.md (spike-2 verified, Gate 0 passed).
    Photo semantics: price is the PAID amount (discounts already folded by
    the prompt); the discount value rides on the line for display, and any
    line the model flags needs_user_check is forced to unverified so it
    lands in the review queue."""
    import base64
    data_uri = f"data:{media_type};base64," + base64.b64encode(image_bytes).decode()
    messages = [{"role": "system", "content": load_photo_prompt()},
                {"role": "user", "content": [
                    {"type": "text", "text": "Decode this receipt photo."},
                    {"type": "image_url", "image_url": {"url": data_uri}}]}]
    reader = photo_reader()
    if reader == "auto" and page:
        # One page of a scanned PDF has no totals of its own, so the
        # receipt checks would flag every page and pay for a Wonder
        # re-read each time. Spark reads the page; the merged receipt is
        # checked once (decode_scanned_pdf, _finish).
        reader = "standard"
    if reader == "auto":
        return _decode_auto(messages, client, image_bytes)
    try:
        if reader == "standard":
            raise RuntimeError("Wonder disabled by ARYA_PHOTO_READER")
        dec = _photo_read(messages, client, mode="wonder",
                          reasoning_effort=None,
                          timeout=PHOTO_WONDER_TIMEOUT_S)
        decoded_by = MODELS["wonder"]
    except Exception:
        dec = _photo_read(messages, client, mode="standard")
        decoded_by = spark_model()
    return _photo_record(dec, image_bytes, decoded_by)


def _photo_record(dec, image_bytes, decoded_by):
    lines = []
    for l in dec.get("lines", []):
        name = " ".join(x for x in [l.get("brand"), l.get("product"), l.get("detail")] if x).strip()
        line = {"raw": name or (l.get("product") or ""), "detail": l.get("detail"),
                "sku": str(l.get("item_no") or ""), "decoded_name": name,
                "qty": l.get("qty") or 1,
                "unit_price": l.get("price"), "line_total": l.get("price"),
                "line_type": "return" if l.get("is_return") else "item",
                "discount_parent_sku": None,
                "discount_amount": l.get("discount") or 0,
                "confidence": l.get("confidence") or 0}
        if l.get("needs_user_check"):
            line["status"] = "unverified"
        lines.append(line)
    subtotal, tax, total = _refund_totals(lines, dec.get("subtotal"), dec.get("tax"), dec.get("total"))
    lines, reconcile = _finish(lines, subtotal)
    rid = "dec-" + hashlib.sha1(image_bytes).hexdigest()[:10]
    rec = {"receipt_id": rid, "source_type": "grocery",
           "merchant": dec.get("store"), "purchased_at": _iso_day(dec.get("date")),
           "lines": lines, "subtotal": subtotal, "tax": tax,
           "total": total, "totals_reconcile": reconcile,
           "image_ref": None, "decoded_by": decoded_by}
    if _num(dec.get("items_sold")):
        rec["items_sold"] = dec["items_sold"]
    keep = clean_store_info(dec.get("store_info"))
    if keep:
        rec["store_info"] = keep
    meta = clean_receipt_meta(dec.get("receipt_meta"))
    if meta:
        rec["receipt_meta"] = meta
    return rec


_STORE_INFO_KEYS = ("chain", "number", "street", "city", "state", "zip")

STORE_HEADER_PROMPT = (
    "You read everything on a paper store receipt photo EXCEPT the item lines: the "
    "store brand, store or warehouse number and address at the top, and the details "
    "printed around the items. Return ONLY a JSON object: {\"store_info\": {\"chain\": str|null, "
    "\"number\": str|null, \"street\": str|null, \"city\": str|null, \"state\": str|null, "
    "\"zip\": str|null}, \"receipt_meta\": {\"phone\": str|null, \"time\": str|null, "
    "\"register\": str|null, \"transaction_no\": str|null, \"cashier\": str|null, "
    "\"member_last4\": str|null, \"payments\": [{\"method\": str, \"last4\": str|null, "
    "\"amount\": number|null}], \"tax_lines\": [{\"label\": str, \"amount\": number}], "
    "\"other\": [str]}}. Copy what is printed. Use null for anything not printed; never "
    "guess a city from the brand and never read the item lines. For any card or "
    "membership number return ONLY its last 4 digits.")


def clean_store_info(info):
    if not isinstance(info, dict):
        return {}
    return {k: str(info[k]).strip() for k in _STORE_INFO_KEYS if info.get(k) not in (None, "")}


_META_TEXT = ("phone", "time", "register", "transaction_no", "cashier")


def _last4(v):
    d = re.sub(r"\D", "", str(v or ""))
    return d[-4:] if d else ""


def clean_receipt_meta(meta):
    """Everything else printed on a receipt, kept small and safe: plain
    strings only, card and membership numbers cut to their last 4 digits
    (a full number is never stored), long digit runs elsewhere masked."""
    if not isinstance(meta, dict):
        return {}

    def txt(v, n=120):
        t = re.sub(r"\d{9,}", lambda m: "…" + m.group(0)[-4:], str(v).strip())
        return t[:n]
    out = {k: txt(meta[k], 60) for k in _META_TEXT if meta.get(k) not in (None, "")}
    if _last4(meta.get("member_last4")):
        out["member_last4"] = _last4(meta["member_last4"])
    pays = []
    for p in (meta.get("payments") or [])[:6]:
        if isinstance(p, dict) and p.get("method"):
            row = {"method": txt(p["method"], 40)}
            if _last4(p.get("last4")):
                row["last4"] = _last4(p["last4"])
            if _num(p.get("amount")):
                row["amount"] = p["amount"]
            pays.append(row)
    if pays:
        out["payments"] = pays
    taxes = [{"label": txt(t["label"], 40), "amount": t["amount"]}
             for t in (meta.get("tax_lines") or [])[:6]
             if isinstance(t, dict) and t.get("label") and _num(t.get("amount"))]
    if taxes:
        out["tax_lines"] = taxes
    other = [txt(o, 100) for o in (meta.get("other") or [])[:10] if isinstance(o, str) and o.strip()]
    if other:
        out["other"] = other
    return out


def read_store_info(image_bytes, client, media_type="image/jpeg"):
    """Header-only re-read of a filed receipt's photo: the store's
    chain, number and address. One short call; no lines are read, so
    nothing on the receipt can change but its store."""
    import base64
    data_uri = f"data:{media_type};base64," + base64.b64encode(image_bytes).decode()
    messages = [{"role": "system", "content": STORE_HEADER_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": "Read the store header."},
                    {"type": "image_url", "image_url": {"url": data_uri}}]}]
    dec = _photo_read(messages, client, mode="standard")
    return clean_store_info(dec.get("store_info")), clean_receipt_meta(dec.get("receipt_meta"))


def _known_sku_prices():
    """Item number -> prices already on this account's receipts, for the
    price-changed check. Empty when there is no account in context."""
    try:
        from api import state
        out = {}
        for r in state.own_receipts():
            for l in r.get("lines", []):
                if l.get("sku") and _num(l.get("line_total")) and l.get("line_type", "item") == "item":
                    out.setdefault(str(l["sku"]), []).append(l["line_total"])
        return out
    except Exception:
        return {}


def _decode_auto(messages, client, image_bytes):
    """Spark reads first; cheap arithmetic checks (decode/checks.py) judge
    the result; Wonder re-reads only a receipt that fails them. A Spark
    failure goes straight to Wonder. The record says which reader filed it
    and why a second read happened, so nothing is silent."""
    from api.decode import checks
    spark = None
    try:
        dec = _photo_read(messages, client, mode="standard")
        spark = _photo_record(dec, image_bytes, spark_model())
        reasons = checks.validate(spark, _known_sku_prices())
    except Exception:
        reasons = ["spark_failed"]
    if spark is not None and not reasons:
        return spark
    try:
        dec = _photo_read(messages, client, mode="wonder", reasoning_effort=None,
                          timeout=PHOTO_WONDER_TIMEOUT_S)
        rec = _photo_record(dec, image_bytes, MODELS["wonder"])
        rec["second_read"] = reasons
        return rec
    except Exception:
        if spark is None:
            raise
        # Wonder is down: keep Spark's read and send every line to review.
        for ln in spark["lines"]:
            if ln.get("line_type", "item") != "discount":
                ln["status"] = "unverified"
        spark["second_read"] = reasons + ["wonder_failed"]
        return spark


ORDER_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..",
                                 "prompts", "order_text_v1.md")


def load_order_prompt():
    text = open(ORDER_PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip()


def decode_order_text(text, client):
    """Pasted online order (Instacart etc.) -> DecodedReceipt via
    meta_client. Personal data: Standard mode only. The same trust model
    as receipts: the model proposes, arithmetic disposes (_finish)."""
    messages = [{"role": "system", "content": load_order_prompt()},
                {"role": "user", "content": "Extract this order:\n\n" + text}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True,
                                     schema=RECEIPT_SCHEMA,
                                     cache_key="arya-order-text-v1")
    dec = parse_json(out)
    lines, reconcile = _finish(dec.get("lines", []), dec.get("subtotal"))
    rid = "ord-" + hashlib.sha1(text.encode()).hexdigest()[:10]
    return {"receipt_id": rid, "source_type": "order",
            "merchant": dec.get("merchant"), "purchased_at": _iso_day(dec.get("purchased_at")),
            "lines": lines, "subtotal": dec.get("subtotal"), "tax": dec.get("tax"),
            "total": dec.get("total"), "totals_reconcile": reconcile,
            "image_ref": None}
