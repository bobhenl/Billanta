"""FastAPI application entrypoint for the AI voice-to-invoice microservice.

See docs/CZ-SK-Invoicing-SaaS-Blueprint.md §6 for the full pipeline spec and
§9 for the non-negotiable "AI drafts are never auto-finalized" rule.

Run locally:
    uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app.config import get_settings
from app.webhooks import internal, telegram, whatsapp

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Faktur AI Voice-to-Invoice Service",
    description=(
        "Telegram/WhatsApp voice-note ingress -> transcription -> "
        "structured extraction -> ARES enrichment -> draft creation via the "
        "backend REST API. Never issues/finalizes invoices itself."
    ),
    version="0.1.0",
)

app.include_router(telegram.router)
app.include_router(whatsapp.router)
app.include_router(internal.router)


@app.get("/health")
async def health() -> dict:
    """Liveness/readiness probe. Does not check downstream dependencies."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ai-service",
        "environment": settings.environment,
    }
