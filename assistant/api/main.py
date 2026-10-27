"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code."""
import os
from fastapi import FastAPI, HTTPException, Request

from api.decode.service import decode_text, normalize_costco_json
from api.meta_client import MetaClient
from api.cost_ledger import CostLedger

app = FastAPI(title="Arya API")
_LEDGER = os.path.join(os.path.dirname(__file__), "..", "loops", "cost-ledger.jsonl")


@app.get("/health")
def health():
    return {"status": "ok", "service": "arya-api", "stage": 1}


@app.post("/import/costco-json")
async def import_costco_json(req: Request):
    obj = await req.json()
    if not isinstance(obj, dict) or "itemArray" not in obj:
        raise HTTPException(422, "not a Costco warehouse receipt object")
    return normalize_costco_json(obj)


@app.post("/decode/text")
async def decode_text_route(req: Request):
    body = await req.json()
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    client = MetaClient(ledger=CostLedger(_LEDGER))
    return decode_text(body.get("text", ""), client)
