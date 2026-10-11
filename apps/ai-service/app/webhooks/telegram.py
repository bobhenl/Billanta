"""Telegram webhook ingress (blueprint §6 step 1).

Verifies Telegram's secret token header, parses an incoming update looking
for a voice message, resolves the sending user to a tenant, and hands off to
the voice-to-invoice pipeline. Unlinked senders get onboarding instructions
instead of being processed further (blueprint §6 step 2).
"""

from __future__ import annotations

import hmac
import logging
import re

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.pipeline.errors import PipelineError
from app.pipeline.schemas import Channel
from app.pipeline.voice_to_invoice import activate_channel_link, orchestrate, send_telegram_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/telegram", tags=["telegram"])


# ---------------------------------------------------------------------------
# Pydantic models for the relevant subset of Telegram's Update schema.
# Full schema: https://core.telegram.org/bots/api#update
# We only model what the voice-note pipeline needs; unrelated update types
# (edited_message, callback_query, etc.) are accepted but ignored.
# ---------------------------------------------------------------------------
class TelegramVoice(BaseModel):
    """Subset of Telegram's `Voice` object we care about."""

    file_id: str
    file_unique_id: str
    duration: int
    mime_type: str | None = None
    file_size: int | None = None


class TelegramUser(BaseModel):
    id: int
    is_bot: bool = False
    first_name: str | None = None
    username: str | None = None


class TelegramChat(BaseModel):
    id: int
    type: str


class TelegramMessage(BaseModel):
    message_id: int
    date: int
    chat: TelegramChat
    from_: TelegramUser | None = Field(default=None, alias="from")
    voice: TelegramVoice | None = None
    text: str | None = None

    model_config = {"populate_by_name": True}


class TelegramUpdate(BaseModel):
    """Top-level Telegram webhook payload."""

    update_id: int
    message: TelegramMessage | None = None


def _verify_secret_token(received: str | None) -> None:
    """Verify the `X-Telegram-Bot-Api-Secret-Token` header against config.

    Uses a constant-time comparison (hmac.compare_digest) to avoid timing
    side-channels, per standard webhook-signature verification practice.
    Raises 401 if missing/mismatched.
    """
    settings = get_settings()
    expected = settings.telegram_webhook_secret

    if not expected:
        # Misconfiguration: refuse to accept unauthenticated webhooks in any
        # environment where the secret hasn't been set.
        logger.error("TELEGRAM_WEBHOOK_SECRET is not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook secret not configured",
        )

    if received is None or not hmac.compare_digest(received, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid secret token",
        )


# `/start <code>` from the Settings -> Kanály deep link. Codes are base64url.
START_RE = re.compile(r"^/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,128})\s*$")

REPLIES = {
    "linked": "Hotovo, tento chat je propojený s vaší firmou v Billantě. Pošlete hlasovou zprávu a připravím z ní koncept faktury.",
    "already_linked": "Tento chat už je s vaší firmou propojený.",
    "invalid": "Kód pro propojení je neplatný nebo vypršel. Vygenerujte nový v Nastavení → Kanály.",
    "conflict": "Tento účet je už propojený s jinou firmou. Nejdřív ho tam odpojte v Nastavení → Kanály.",
    "unlinked": "Tento chat zatím není propojený. V Billantě otevřete Nastavení → Kanály a klikněte na Propojit Telegram.",
    "error": "Propojení se teď nepovedlo, zkuste to prosím za chvíli znovu.",
}


async def _handle_text(message: TelegramMessage) -> None:
    """Route text commands. Only private chats may link: in a group every
    member could then create invoices for the company."""
    text = (message.text or "").strip()
    match = START_RE.match(text)
    if not match:
        if text.startswith("/start"):
            await send_telegram_message(message.chat.id, REPLIES["unlinked"])
        return
    if message.chat.type != "private" or message.from_ is None or message.from_.is_bot:
        await send_telegram_message(message.chat.id, REPLIES["invalid"])
        return
    display = f"@{message.from_.username}" if message.from_.username else message.from_.first_name
    try:
        outcome = await activate_channel_link(
            Channel.TELEGRAM, match.group(1), str(message.from_.id), display
        )
    except Exception:
        logger.exception("telegram_webhook: channel activation failed")
        outcome = "error"
    await send_telegram_message(message.chat.id, REPLIES[outcome])


@router.post("")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(
        default=None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
) -> dict:
    """Receive a Telegram webhook update.

    Real logic: secret-token verification (constant-time compare) and
    request parsing/validation against `TelegramUpdate`. The actual
    media-download/transcription/extraction pipeline is stubbed further down
    the call chain (see app/pipeline/voice_to_invoice.py).
    """
    _verify_secret_token(x_telegram_bot_api_secret_token)

    body = await request.json()
    update = TelegramUpdate.model_validate(body)

    if update.message is not None and update.message.text and update.message.voice is None:
        await _handle_text(update.message)
        return {"ok": True}

    if update.message is None or update.message.voice is None:
        # Not a voice message (sticker, photo, etc.) - nothing to do.
        logger.debug("telegram_webhook: update %s has no voice message, ignoring", update.update_id)
        return {"ok": True}

    voice = update.message.voice
    external_user_id = str(
        update.message.from_.id if update.message.from_ else update.message.chat.id
    )

    try:
        result = await orchestrate(
            channel=Channel.TELEGRAM,
            external_user_id=external_user_id,
            file_id=voice.file_id,
            mime_type=voice.mime_type or "audio/ogg",
        )
    except PipelineError as exc:
        # A real (non-stub) pipeline step failed - e.g. oversized media,
        # transcription/extraction failure, download error. `exc.user_message`
        # is safe to relay to the end user; we still ack the webhook with 200
        # so Telegram doesn't retry-storm us on a failure that won't resolve
        # itself by resending the same update.
        logger.warning(
            "telegram_webhook: pipeline error for external_user_id=%s: %s",
            external_user_id,
            exc,
        )
        # TODO: send exc.user_message back to the chat via the Telegram Bot
        # API (sendMessage) - not implemented here, this handler only
        # acknowledges the webhook.
        return {"ok": True}
    except Exception:
        # Unexpected failure (network blip, backend outage, etc.) - log with
        # full traceback for diagnostics but still ack the webhook.
        logger.exception(
            "telegram_webhook: unexpected pipeline failure for external_user_id=%s",
            external_user_id,
        )
        # TODO: send a generic failure message back to the chat via the
        # Telegram Bot API (sendMessage) - not implemented here.
        return {"ok": True}

    if result is None:
        await send_telegram_message(update.message.chat.id, REPLIES["unlinked"])
        logger.info("telegram_webhook: unresolved tenant for external_user_id=%s", external_user_id)

    return {"ok": True}
