"""Decode service — three inputs, one DecodedReceipt contract (§3).

Paths: normalize_costco_json (structured export, $0, no model),
decode_text (PDF text via meta_client, Standard + personal).
Photo decode joins after the Gate 0 verdict.
Post-rules in code: discount lines must name a parent SKU (orphans attach
to the previous item line and drop to unverified); status is auto at
confidence >= 0.8, else unverified; totals_reconcile is computed, never
taken from the model.
"""
import hashlib, json, os

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "decode_v2.md")
AUTO_THRESHOLD = 0.8


def load_prompt():
    text = open(PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip()


def _attach_discounts(lines):
    last_item_sku = None
    for ln in lines:
        if ln["line_type"] == "item":
            last_item_sku = ln.get("sku")
        elif ln["line_type"] == "discount" and not ln.get("discount_parent_sku"):
            ln["discount_parent_sku"] = last_item_sku
            ln["status"] = "unverified"  # attachment was inferred, not read
    return lines


def _finish(lines, subtotal):
    for ln in lines:
        ln.setdefault("allocation", "HOUSEHOLD")
        ln.setdefault("for_person", None)
        ln.setdefault("item_id", None)
        ln.setdefault("judge_agree", None)
        if "status" not in ln:
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
            "purchased_at": obj.get("transactionDate"),
            "lines": lines, "subtotal": obj.get("subTotal"),
            "tax": obj.get("taxes"), "total": obj.get("total"),
            "totals_reconcile": reconcile, "image_ref": None}


def decode_text(text, client):
    """PDF-extracted receipt text -> DecodedReceipt via meta_client.
    Personal data: Standard mode only (enforced in meta_client)."""
    messages = [{"role": "system", "content": load_prompt()},
                {"role": "user", "content": "Decode this receipt text:\n\n" + text}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    lines, reconcile = _finish(dec.get("lines", []), dec.get("subtotal"))
    rid = "dec-" + hashlib.sha1(text.encode()).hexdigest()[:10]
    return {"receipt_id": rid, "source_type": "grocery",
            "merchant": dec.get("merchant"), "purchased_at": dec.get("purchased_at"),
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


def decode_photo(image_bytes, client, media_type="image/jpeg"):
    """Receipt photo -> DecodedReceipt via meta_client vision.
    Personal data: Standard mode only (enforced in meta_client).
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
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
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
            "merchant": dec.get("store"), "purchased_at": dec.get("date"),
            "lines": lines, "subtotal": dec.get("subtotal"), "tax": dec.get("tax"),
            "total": dec.get("total"), "totals_reconcile": reconcile,
            "image_ref": None}
