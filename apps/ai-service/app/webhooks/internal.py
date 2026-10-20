"""Calls from the backend into this service (not reachable by end users).

`POST /internal/transcribe` turns a voice note recorded in the dashboard into
text with the same ffmpeg + Whisper step the Telegram/WhatsApp notes use. The
backend does the rest (invoice suggestion, contact matching, the
`pending_review` draft), so the tenant's AI settings and limits apply there
and this service never touches tenant data on this path.

The audio is the raw request body: python-multipart is not a dependency and
the backend has already parsed the upload.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Query, Request, status

from app.config import get_settings
from app.pipeline.errors import EmptyTranscriptError, MediaTooLargeError, PipelineError
from app.pipeline.voice_to_invoice import WHISPER_MAX_BYTES, transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

LANGUAGES = {"cs", "sk", "en"}


def _verify_internal_token(received: str | None) -> None:
    expected = get_settings().internal_api_token
    # An unset token must not mean "open": refuse everything instead.
    if not expected or received is None or not hmac.compare_digest(received, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token")


@router.post("/transcribe")
async def transcribe(
    request: Request,
    x_internal_token: str | None = Header(default=None),
    content_type: str | None = Header(default=None),
    language: str | None = Query(default=None),
) -> dict:
    _verify_internal_token(x_internal_token)

    mime_type = (content_type or "").split(";")[0].strip().lower()
    if not mime_type.startswith("audio/"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="unsupported_type")

    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=422, detail="empty_audio")
    if len(audio) > WHISPER_MAX_BYTES:
        raise HTTPException(status_code=413, detail="too_large")

    try:
        transcript = await transcribe_audio(
            audio,
            mime_type=mime_type,
            language=language if language in LANGUAGES else None,
        )
    except MediaTooLargeError:
        raise HTTPException(status_code=413, detail="too_large")
    except EmptyTranscriptError:
        raise HTTPException(status_code=422, detail="empty_transcript")
    except PipelineError:
        # Logged, not returned: the technical message can carry ffmpeg or
        # OpenAI internals. The backend maps 502 to a retryable error.
        logger.exception("dashboard voice note transcription failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="transcription_failed")

    return {"transcript": transcript}
