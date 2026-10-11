"""WhatsApp (Meta Cloud API) webhook ingress (blueprint §6 step 1).

Two routes:
    - GET  /webhook/whatsapp: Meta's webhook verification handshake
      (hub.mode / hub.verify_token / hub.challenge).
    - POST /webhook/whatsapp: actual event delivery, authenticated via a
      real HMAC-SHA256 signature check against `X-Hub-Signature-256`.

Rollout note (blueprint §6): WhatsApp is Phase 6, gated on Meta Business
Cloud API verification - this route exists now so the webhook contract is
ready, even though the linking/media-download flow is stubbed.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response, status

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/whatsapp", tags=["whatsapp"])


def _compute_signature(app_secret: str, payload: bytes) -> str:
    """Compute the `sha256=<hex>` signature Meta expects us to reproduce."""
    digest = hmac.new(app_secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _verify_signature(app_secret: str, payload: bytes, header_value: str | None) -> None:
    """Verify `X-Hub-Signature-256` via real HMAC-SHA256, constant-time compare.

    See: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
    Raises 401 if the header is missing or doesn't match.
    """
    if not app_secret:
        logger.error("WHATSAPP_APP_SECRET is not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="WhatsApp app secret not configured",
        )

    if not header_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Hub-Signature-256 header",
        )

    expected = _compute_signature(app_secret, payload)
    if not hmac.compare_digest(expected, header_value):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Signature mismatch",
        )


@router.get("")
async def whatsapp_verify(
    hub_mode: str = Query(default="", alias="hub.mode"),
    hub_verify_token: str = Query(default="", alias="hub.verify_token"),
    hub_challenge: str = Query(default="", alias="hub.challenge"),
) -> Response:
    """Meta's webhook verification handshake.

    Meta calls this once when the webhook URL is configured in the Meta App
    Dashboard. We must echo back `hub.challenge` as plain text if
    `hub.verify_token` matches our configured token, otherwise reject.
    """
    settings = get_settings()

    if hub_mode != "subscribe" or not hmac.compare_digest(
        hub_verify_token, settings.whatsapp_webhook_verify_token
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")

    return Response(content=hub_challenge, media_type="text/plain")


@router.post("")
async def whatsapp_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
) -> dict:
    """Receive a WhatsApp Cloud API webhook event.

    Real logic: HMAC-SHA256 signature verification against the raw request
    body (must use the raw bytes, not a re-serialized JSON object, since
    Meta signs the exact bytes it sent). The actual media-message parsing /
    pipeline hookup is left as TODO pending Phase 6 (blueprint §6 rollout
    order: WhatsApp requires Meta Business verification with real
    calendar-time lead).
    """
    settings = get_settings()
    raw_body = await request.body()
    _verify_signature(settings.whatsapp_app_secret, raw_body, x_hub_signature_256)

    body = await request.json()

    # TODO: parse the WhatsApp Cloud API "messages" webhook payload (entry ->
    # changes -> value -> messages[]) into a Pydantic model analogous to
    # TelegramUpdate, extract voice/audio messages, resolve the media ID via
    # the Meta Media endpoint (download_media in voice_to_invoice.py), and
    # call orchestrate(channel=Channel.WHATSAPP, ...). Left unimplemented -
    # WhatsApp is Phase 6 per blueprint §6 rollout order.
    logger.debug("whatsapp_webhook: received payload with %d top-level keys, not yet processed", len(body))

    return {"ok": True}
