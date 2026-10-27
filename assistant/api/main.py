"""Arya API — FastAPI entry point. Stage 0: health only.
All Meta calls go through api.meta_client; all money math is code."""
from fastapi import FastAPI

app = FastAPI(title="Arya API")


@app.get("/health")
def health():
    return {"status": "ok", "service": "arya-api", "stage": 0}
