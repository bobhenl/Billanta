"""Exceptions raised by the voice-to-invoice pipeline's real implementations.

Kept separate from `voice_to_invoice.py` so webhooks can import and handle
them without pulling in the orchestration logic, and so tests can assert on
them without importing the (heavier) OpenAI/httpx call sites.

Every exception carries a `user_message` attribute: a short, non-technical
string safe to relay back to the end user in their chat (Telegram/WhatsApp),
as distinct from `str(exc)`, which is the detailed, technical message meant
for logs. Callers (webhook handlers) should prefer `user_message` when
composing a reply and log the exception itself for diagnostics.
"""

from __future__ import annotations


class PipelineError(Exception):
    """Base class for all real (non-stub) pipeline failures.

    Subclasses must set `self.user_message` to a short, human-readable string
    safe to show to the end user (never leak internals like stack traces,
    raw API error bodies, or secrets in `user_message`).
    """

    user_message: str = "Something went wrong while processing your voice message. Please try again."

    def __init__(self, technical_message: str, *, user_message: str | None = None) -> None:
        super().__init__(technical_message)
        if user_message is not None:
            self.user_message = user_message


class MediaDownloadError(PipelineError):
    """Raised when the media file cannot be retrieved from the channel API.

    Covers configuration issues (missing bot token/access token), the
    channel API reporting an error, or a network failure.
    """

    user_message = (
        "We couldn't download your voice message. Please try sending it again."
    )


class MediaTooLargeError(PipelineError):
    """Raised when a voice note exceeds Whisper's or Telegram's size limit."""

    def __init__(self, size_bytes: int, limit_bytes: int, limit_name: str) -> None:
        self.size_bytes = size_bytes
        self.limit_bytes = limit_bytes
        self.limit_name = limit_name
        limit_mb = limit_bytes / (1024 * 1024)
        size_mb = size_bytes / (1024 * 1024)
        super().__init__(
            f"media exceeds {limit_name} limit: {size_bytes} bytes > {limit_bytes} bytes "
            f"({size_mb:.1f} MB > {limit_mb:.0f} MB)",
            user_message=(
                f"Your voice message is too large ({size_mb:.1f} MB). "
                f"Please keep voice notes under {limit_mb:.0f} MB and try again."
            ),
        )


class TranscriptionError(PipelineError):
    """Raised when ffmpeg remuxing or the Whisper transcription call fails."""

    user_message = (
        "We couldn't understand your voice message. Please try recording it again "
        "in a quiet environment."
    )


class EmptyTranscriptError(TranscriptionError):
    """Whisper ran fine but heard no speech (silence, a pocket recording)."""


class ExtractionError(PipelineError):
    """Raised when GPT-4o structured extraction fails schema validation twice
    or the OpenAI call itself fails.
    """

    user_message = (
        "We had trouble understanding the invoice details in your message. "
        "Please try describing the client, items, and prices more clearly."
    )


class AresLookupError(PipelineError):
    """Raised on unexpected (non-404) failures calling the backend's ARES
    enrichment endpoint. Callers should generally catch this and proceed
    with a `needs_attention` draft rather than dropping the message
    (blueprint §6 step 10) — it is provided for callers that want to
    distinguish this failure mode explicitly.
    """

    user_message = (
        "We created your invoice draft, but couldn't verify the client's "
        "business registration automatically. Please double-check it in the dashboard."
    )
