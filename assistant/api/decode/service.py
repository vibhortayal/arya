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
import hashlib, json, os
from datetime import datetime

from api.meta_client import MODELS


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
    return v

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


def load_prompt():
    text = open(PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip()


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


def _finish(lines, subtotal):
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


def decode_text(text, client):
    """PDF-extracted receipt text -> DecodedReceipt via meta_client.
    Personal data: Standard mode only (enforced in meta_client)."""
    messages = [{"role": "system", "content": load_prompt()},
                {"role": "user", "content": "Decode this receipt text:\n\n" + text}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True,
                                     schema=RECEIPT_SCHEMA,
                                     cache_key="arya-decode-text-v2")
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
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


PHOTO_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "decode_photo_v1.md")


def load_photo_prompt():
    text = open(PHOTO_PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip()


# Photo decode reads with Wonder first, per the MODEL-POLICY hackathon
# amendment (through 2026-11-04; WONDER-EVAL.md is the evidence: Gate 0
# public photos, Wonder 98.98% identity+price vs Spark 93.88%, price
# errors 0 vs 4, silent errors 0 vs 4). Wonder's cost is latency —
# 34.4 s mean / 60.5 s p95 in the eval — so the attempt is bounded at
# 90 s (p95 plus headroom) and ANY failure (timeout, HTTP error,
# unparseable output) falls back to Spark Standard, the previous
# production reader at its production configuration. The receipt
# records the reader in decoded_by, so a fallback is never silent.
PHOTO_WONDER_TIMEOUT_S = 90


def _photo_read(messages, client, **kw):
    out, _usage, _cost = client.chat(messages, personal=True, **kw)
    try:
        return json.loads(out)
    except Exception:
        return json.loads(out[out.find("{"): out.rfind("}") + 1])


def decode_photo(image_bytes, client, media_type="image/jpeg"):
    """Receipt photo -> DecodedReceipt via meta_client vision.
    Personal data: handled under the MODEL-POLICY hackathon amendment
    (Wonder for this path through 2026-11-04; meta_client still refuses
    Contributor for personal payloads).
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
    try:
        dec = _photo_read(messages, client, mode="wonder",
                          reasoning_effort=None,
                          timeout=PHOTO_WONDER_TIMEOUT_S)
        decoded_by = MODELS["wonder"]
    except Exception:
        dec = _photo_read(messages, client, mode="standard")
        decoded_by = MODELS["standard"]
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
    lines, reconcile = _finish(lines, dec.get("subtotal"))
    rid = "dec-" + hashlib.sha1(image_bytes).hexdigest()[:10]
    return {"receipt_id": rid, "source_type": "grocery",
            "merchant": dec.get("store"), "purchased_at": _iso_day(dec.get("date")),
            "lines": lines, "subtotal": dec.get("subtotal"), "tax": dec.get("tax"),
            "total": dec.get("total"), "totals_reconcile": reconcile,
            "image_ref": None, "decoded_by": decoded_by}


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
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    lines, reconcile = _finish(dec.get("lines", []), dec.get("subtotal"))
    rid = "ord-" + hashlib.sha1(text.encode()).hexdigest()[:10]
    return {"receipt_id": rid, "source_type": "order",
            "merchant": dec.get("merchant"), "purchased_at": _iso_day(dec.get("purchased_at")),
            "lines": lines, "subtotal": dec.get("subtotal"), "tax": dec.get("tax"),
            "total": dec.get("total"), "totals_reconcile": reconcile,
            "image_ref": None}
