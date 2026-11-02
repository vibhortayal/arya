"""Getting receipts in: Costco JSON import, receipt text, PDF and photo decode, structured intake, the curator, and voice transcription."""
import json
import logging
import os

from api.errors import safe_detail
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import own_key
from api import state, stores
from api.decode.service import (decode_order_text, decode_photo, decode_scanned_pdf, decode_text, expand_costco_names,
                                extract_pdf_text, normalize_costco_json)
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _json_body, _json_obj, new_client

router = APIRouter()


async def _find_stores(*receipts):
    """Name the receipts' stores through Google Places before filing."""
    await run_in_threadpool(stores.resolve_merchants, [r.get("merchant") for r in receipts])


async def _expand_names(decs):
    """Read abbreviated names on JSON-export lines (best effort, skipped
    without a key or over budget). Lines the household already named stay."""
    if not own_key.model_ready():
        return
    try:
        _budget_guard()
    except HTTPException:
        return
    taught = {e["sku"] for e in state.dictionary()["entries"]
              if e.get("sku") and (e.get("resolution") or {}).get("status") == "manual"}
    client = new_client()
    for dec in decs:
        await run_in_threadpool(expand_costco_names, dec, client, taught)


@router.post("/import/costco-json")
async def import_costco_json(req: Request):
    obj = await _json_body(req)
    if not isinstance(obj, dict) or "itemArray" not in obj:
        raise HTTPException(422, "not a Costco warehouse receipt object")
    dec = normalize_costco_json(obj)
    await _expand_names([dec])
    await _find_stores(dec)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, new_client())
    return dec


@router.post("/import/costco-json-bulk")
async def import_bulk(req: Request):
    objs = await _json_body(req)
    if not isinstance(objs, list):
        raise HTTPException(422, "expected a list of Costco receipt objects")
    decs = [normalize_costco_json(o) for o in objs if isinstance(o, dict) and "itemArray" in o]
    await _expand_names(decs)
    await _find_stores(*decs)
    added = state.add_receipts(decs)
    await run_in_threadpool(state.judge_pending, new_client())
    return {"received": len(decs), "added": added, "total_receipts": len(state.receipts())}


@router.post("/decode/text")
async def decode_text_route(req: Request):
    body = await _json_obj(req)
    own_key.need_model()
    _budget_guard()
    client = new_client()
    dec = await run_in_threadpool(decode_text, body.get("text", ""), client)
    await _find_stores(dec)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, new_client())
    return dec


def _need_receipt_date(receipt):
    """state.add_receipts refuses a receipt with no date, so say so
    here instead of answering "added" with an id that was never
    filed (a hunt finish then failed with "no such receipt")."""
    if not receipt.get("purchased_at"):
        raise HTTPException(422, "could not read the date on this receipt — "
                            "retake the photo with the date in view")


@router.post("/api/intake/order-text")
async def intake_order_text(req: Request):
    """A pasted online order (Instacart, Amazon Fresh, ...) becomes a
    receipt through the same verify-and-queue path as a photo."""
    body = await _json_obj(req)
    text = body.get("text", "")
    if len(text.strip()) < 20:
        raise HTTPException(422, "paste the order confirmation text")
    own_key.need_model()
    _budget_guard()
    client = new_client()
    dec = await run_in_threadpool(decode_order_text, text, client)
    _need_receipt_date(dec)
    await _find_stores(dec)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, new_client())
    return {"receipt_id": dec["receipt_id"], "merchant": dec["merchant"],
            "purchased_at": dec["purchased_at"], "lines": len(dec["lines"]),
            "total": dec["total"], "totals_reconcile": dec["totals_reconcile"]}


@router.post("/api/intake/structured")
async def intake_structured(req: Request):
    """A receipt already read by the user's own Muse. Arya spends no
    tokens on perception here: it verifies the arithmetic, assigns line
    statuses by confidence, and queues what does not verify — the client
    proposes, Arya disposes."""
    body = await _json_body(req)
    if not isinstance(body, dict) or not body.get("merchant") \
            or not body.get("purchased_at") \
            or not isinstance(body.get("lines"), list) or not body["lines"]:
        raise HTTPException(422, "a structured receipt needs merchant, purchased_at, and lines")
    from api.decode.service import _finish
    lines = []
    for ln in body["lines"]:
        if not isinstance(ln, dict) or not ln.get("decoded_name") \
                or not isinstance(ln.get("line_total"), (int, float)):
            raise HTTPException(422, "every line needs decoded_name and a numeric line_total")
        lt = ln.get("line_type") or "item"
        lines.append({
            "raw": ln.get("raw") or ln["decoded_name"],
            "decoded_name": ln["decoded_name"],
            "qty": ln.get("qty") if isinstance(ln.get("qty"), (int, float)) else 1,
            "unit_price": ln.get("unit_price"),
            "line_total": float(ln["line_total"]),
            "line_type": lt if lt in ("item", "discount", "return") else "item",
            "sku": ln.get("sku"), "discount_parent_sku": ln.get("discount_parent_sku"),
            "confidence": ln.get("confidence") if isinstance(ln.get("confidence"), (int, float)) else 0.5,
            "alternatives": []})
    lines, reconcile = _finish(lines, body.get("subtotal"))
    rid = body.get("receipt_id")
    if not isinstance(rid, str) or not rid:
        import hashlib as _h
        rid = "ext-" + _h.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:10]
    dec = {"receipt_id": rid, "source_type": "muse",
           "merchant": body["merchant"], "purchased_at": body["purchased_at"],
           "lines": lines, "subtotal": body.get("subtotal"),
           "tax": body.get("tax"), "total": body.get("total"),
           "totals_reconcile": reconcile, "image_ref": None}
    await _find_stores(dec)
    added = state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, new_client())
    # The ledger counts a line only when it has a sku, so a line
    # without one is kept on the receipt but never reaches patterns,
    # running low or spend. Say so instead of returning a clean success.
    no_sku = [l["decoded_name"] for l in lines
              if l["line_type"] != "discount" and not l.get("sku")]
    out = {"receipt_id": rid, "merchant": dec["merchant"], "added": added,
           "lines": len(lines), "totals_reconcile": reconcile,
           "unverified": sum(1 for l in lines if l["status"] != "auto")}
    if no_sku:
        out["no_sku"] = no_sku
        out["warning"] = (f"{len(no_sku)} line(s) have no sku, so they are saved "
                          "but not counted toward patterns or running low.")
    return out


@router.post("/api/curator/run")
def curator_run():
    own_key.need_model()
    _budget_guard()
    from api.curator import run_curator
    n = run_curator(new_client())
    return {"proposals": n}


@router.get("/api/curator")
def curator_pending():
    from api.curator import pending
    return {"proposals": pending()}


@router.post("/api/curator/decide")
async def curator_decide(req: Request):
    body = await _json_obj(req)
    from api.curator import decide
    try:
        p = decide(body.get("id", ""), body.get("action", ""))
    except KeyError:
        raise HTTPException(404, "unknown or settled proposal")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": p["id"], "status": p["status"]}


@router.post("/decode/pdf")
async def decode_pdf(req: Request):
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 10_000_000:
        raise HTTPException(413, "PDF too large (10 MB max)")
    try:
        text = await run_in_threadpool(extract_pdf_text, body)
    except Exception:
        raise HTTPException(422, "could not read this PDF")
    own_key.need_model()
    _budget_guard()
    client = new_client()
    try:
        if len(text.strip()) < 20:
            # A scan: no text layer, so the pages are read as photos.
            receipt = await run_in_threadpool(decode_scanned_pdf, body, client)
        else:
            receipt = await run_in_threadpool(decode_text, text, client)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))
    _need_receipt_date(receipt)
    dup = state.find_duplicate(receipt)
    if dup is not None:
        # Same receipt filed before: hand back the record on file
        # (the hunt doors settle by its id) and file nothing twice.
        return {"added": 0, "duplicate": True,
                "total_receipts": len(state.receipts()), "receipt": dup}
    await _find_stores(receipt)
    added = state.add_receipts(
        [receipt], media={receipt["receipt_id"]: (body, "application/pdf")})
    if not added:
        # The decode id is content-derived, so an exact re-upload
        # lands here rather than in the fingerprint check above.
        dup = next((r for r in state.receipts()
                    if r["receipt_id"] == receipt["receipt_id"]), receipt)
        return {"added": 0, "duplicate": True,
                "total_receipts": len(state.receipts()), "receipt": dup}
    await run_in_threadpool(state.judge_pending, new_client())
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@router.post("/decode/photo")
async def decode_photo_route(req: Request):
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a receipt photo (image) or send a PDF to /decode/pdf")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    own_key.need_model()
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    try:
        receipt = await run_in_threadpool(decode_photo, body, client,
                                          media_type=media)
    except RuntimeError as e:
        logging.getLogger("arya.input").warning("input failure: receipt photo model error (%s)", str(e)[:120])
        raise HTTPException(502, safe_detail(e))
    try:
        _need_receipt_date(receipt)
    except HTTPException:
        logging.getLogger("arya.input").info("input failure: receipt photo had no readable date")
        raise
    if demo:
        # The demo files into the visitor's sandbox (never disk), so a
        # hunt can finish on its receipt; the batch judge does not run.
        receipt["live"] = True
        added = state.add_receipts([receipt])
        return {"demo": True, "added": added, "receipt": receipt}
    dup = state.find_duplicate(receipt)
    if dup is not None:
        return {"added": 0, "duplicate": True,
                "total_receipts": len(state.receipts()), "receipt": dup}
    await _find_stores(receipt)
    added = state.add_receipts(
        [receipt], media={receipt["receipt_id"]: (body, media)})
    if not added:
        dup = next((r for r in state.receipts()
                    if r["receipt_id"] == receipt["receipt_id"]), receipt)
        return {"added": 0, "duplicate": True,
                "total_receipts": len(state.receipts()), "receipt": dup}
    await run_in_threadpool(state.judge_pending, new_client())
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@router.post("/api/transcribe")
async def transcribe_route(req: Request):
    """Muse Voice Transcribe, proxied: the browser sends a WAV
    recording (mono 16-bit PCM, 16 kHz — the batch endpoint's input
    contract) and the server key makes the call. Stateless by design:
    the transcript is returned, never stored, for every account
    including the demo."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if media not in ("audio/wav", "audio/x-wav", "audio/wave"):
        raise HTTPException(415, "send a WAV recording (audio/wav)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty recording")
    if len(body) > 10_000_000:
        raise HTTPException(413, "recording too large — keep it under a few minutes")
    own_key.need_model()
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    from api.voice.service import transcribe_audio
    from api.chat_service import LANGUAGES, _language_setting
    lang = _language_setting()
    client = new_client()
    try:
        out = await run_in_threadpool(transcribe_audio, body, client,
                                      LANGUAGES.get(lang))
    except ValueError as e:
        logging.getLogger("arya.input").info("input failure: voice rejected (%s)", e)
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        logging.getLogger("arya.input").warning("input failure: voice model error (%s)", str(e)[:120])
        raise HTTPException(502, safe_detail(e))
    return {"text": out["text"], "duration_s": out["duration_s"],
            "model": "muse-voice-transcribe-1.0", "demo": demo}
