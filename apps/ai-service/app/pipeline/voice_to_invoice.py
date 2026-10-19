"""Voice-to-invoice orchestration pipeline.

Implements the 10-step pipeline from blueprint §6 as a sequence of clearly
separated async functions. This module is called by the channel webhooks
(`app/webhooks/telegram.py`, `app/webhooks/whatsapp.py`) once a voice message
has been identified.

Non-negotiable rule (blueprint §6 step 8/9, §9): this pipeline creates
`pending_review` drafts ONLY. It must NEVER call an issue/finalize endpoint —
a human always confirms in the dashboard before an invoice is legally issued.

Real logic vs. stubs:
    - resolve_tenant: REAL — calls the backend's channel-link verification
      endpoint over httpx.
    - download_media: REAL — Telegram getFile+download and WhatsApp Graph
      API media resolution+download, both over httpx, with Whisper/Telegram
      file-size enforcement.
    - transcribe_audio: REAL — ffmpeg remux (subprocess) + OpenAI Whisper
      (`whisper-1`) transcription via the `openai` SDK.
    - extract_invoice_data: REAL — GPT-4o structured-output call
      (`response_format={"type": "json_schema", ...}`) validated into
      ExtractedInvoiceDraft, with one retry on schema-validation failure.
    - enrich_with_ares: REAL — calls the backend's
      `POST /api/v1/contacts/ares-lookup` endpoint over httpx.
    - create_draft_invoice: REAL — posts the draft to the backend with the
      scoped service JWT.
    - orchestrate: REAL — wires the above together in §6's step order.

Confidence note (see README "Real vs stubbed" table for the full breakdown):
download_media/transcribe_audio/extract_invoice_data/enrich_with_ares are
written correctly per each API's documented contract and covered by unit
tests with mocked httpx/openai clients, but have NOT been exercised against
live Telegram/WhatsApp/OpenAI/backend credentials — no such credentials exist
in this environment.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from pathlib import Path

import httpx
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.pipeline.errors import (
    EmptyTranscriptError,
    ExtractionError,
    MediaDownloadError,
    MediaTooLargeError,
    TranscriptionError,
)
from app.pipeline.schemas import (
    AresEnrichment,
    AresMatchStatus,
    Channel,
    DraftInvoicePayload,
    ExtractedInvoiceDraft,
)

logger = logging.getLogger(__name__)

# --- Telegram Bot API ---
TELEGRAM_API_BASE = "https://api.telegram.org"

# --- Meta WhatsApp Cloud API (Graph API) ---
# Pinned API version - bump deliberately, Meta deprecates old versions on a
# published schedule.
WHATSAPP_GRAPH_API_VERSION = "v21.0"
WHATSAPP_GRAPH_API_BASE = f"https://graph.facebook.com/{WHATSAPP_GRAPH_API_VERSION}"

# --- File-size limits (blueprint §6 step 3/4-5) ---
# OpenAI Whisper's hard per-file limit (applies to whisper-1 and
# gpt-4o-transcribe alike as of this writing).
WHISPER_MAX_BYTES = 25 * 1024 * 1024
# Telegram Bot API's own cap on files bots can download via getFile/the
# /file/ endpoint (larger files are only reachable via a local Bot API
# server, which this service does not run).
TELEGRAM_MAX_BYTES = 50 * 1024 * 1024

# --- GPT-4o structured extraction (blueprint §6 step 6) ---
EXTRACTION_MODEL = "gpt-4o"
EXTRACTION_MAX_ATTEMPTS = 2  # initial attempt + one retry on validation failure

EXTRACTION_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "counterparty_name_raw": {
            "type": "string",
            "description": "Counterparty name as spoken/transcribed, unverified.",
        },
        "counterparty_ico": {
            "type": ["string", "null"],
            "description": (
                "IČO (Czech/Slovak 8-digit business ID) if explicitly spoken "
                "or clearly inferable, otherwise null."
            ),
        },
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "quantity": {"type": "number"},
                    "unit_price": {"type": "number"},
                    "vat_rate": {
                        "type": ["number", "null"],
                        "description": "VAT rate as a percentage (e.g. 21 for 21%), or null if not mentioned.",
                    },
                },
                "required": ["description", "quantity", "unit_price", "vat_rate"],
                "additionalProperties": False,
            },
        },
        "currency": {"type": "string", "description": "ISO 4217 currency code."},
        "due_date_hint": {
            "type": ["string", "null"],
            "description": (
                "Free-text due-date hint from the transcript (e.g. 'do 14 dnů', "
                "'konec měsíce'), NOT a parsed date, or null if not mentioned."
            ),
        },
        "notes": {"type": ["string", "null"]},
    },
    "required": [
        "counterparty_name_raw",
        "counterparty_ico",
        "line_items",
        "currency",
        "due_date_hint",
        "notes",
    ],
    "additionalProperties": False,
}

EXTRACTION_SYSTEM_PROMPT = (
    "You are an assistant that extracts structured invoice data from a "
    "transcribed voice message. The speaker is a Czech or Slovak freelancer "
    "or small-business owner (occasionally speaking English) describing work "
    "performed or goods delivered for a specific client, meant to become an "
    "invoice draft.\n\n"
    "Rules:\n"
    "- Extract only what is stated or clearly implied in the transcript; "
    "leave a field null rather than guessing.\n"
    "- counterparty_ico is the Czech/Slovak business ID (IČO, typically 8 "
    "digits) - only fill it if a number is explicitly spoken that plausibly "
    "is one.\n"
    "- due_date_hint must be the speaker's own words about the payment due "
    "date (e.g. 'do 14 dnů', 'konec měsíce'), never a computed/parsed date.\n"
    "- Each line item needs a description, quantity, and unit_price. If the "
    "speaker gives a single lump sum for one piece of work, use quantity=1 "
    "and unit_price=that sum.\n"
    "- vat_rate is a percentage number (e.g. 21) if mentioned, otherwise "
    "null - never assume a default VAT rate.\n"
    "- Default currency to CZK unless another currency is clearly stated "
    "(e.g. EUR for Slovak speakers).\n"
    "- Respond ONLY with JSON matching the provided schema."
)


# ---------------------------------------------------------------------------
# Step 2: Tenant resolution / account linking
# ---------------------------------------------------------------------------
async def resolve_tenant(
    channel: Channel | str,
    external_user_id: str,
    *,
    settings: Settings | None = None,
) -> str | None:
    """Resolve an inbound channel sender to a tenant_id.

    Blueprint §6 step 2: an unrecognized sender must be rejected (never
    processed) and pointed at onboarding instructions instead. This calls the
    backend's `POST /api/v1/internal/channel-links/verify` endpoint (service-scoped JWT only), which is the
    single source of truth for the `channel_links` table (tenant isolation
    lives in the backend/DB, not here).

    Returns:
        The tenant_id (as a string UUID) if the sender is linked and active,
        otherwise None.
    """
    settings = settings or get_settings()
    async with httpx.AsyncClient(base_url=settings.backend_api_url, timeout=10.0) as client:
        response = await client.post(
            "/api/v1/internal/channel-links/verify",
            headers={"Authorization": f"Bearer {settings.backend_service_jwt}"},
            json={
                "channel": Channel(channel).value if not isinstance(channel, str) else channel,
                "external_user_id": external_user_id,
            },
        )

    if response.status_code == 404:
        # Unlinked sender — caller must send onboarding instructions and stop.
        return None

    response.raise_for_status()
    body = response.json()
    # The backend answers in camelCase (`tenantId`); accept both spellings.
    return body.get("tenantId") or body.get("tenant_id")


async def activate_channel_link(
    channel: Channel | str,
    linking_token: str,
    external_user_id: str,
    display_name: str | None = None,
    *,
    settings: Settings | None = None,
) -> str:
    """Consume a linking code the sender passed to the bot (`/start <code>`).

    Returns "linked", "already_linked", "invalid" (unknown/expired/used code)
    or "conflict" (this sender already belongs to another company).
    """
    settings = settings or get_settings()
    payload: dict = {
        "channel": Channel(channel).value if not isinstance(channel, str) else channel,
        "linking_token": linking_token,
        "external_user_id": external_user_id,
    }
    if display_name:
        payload["display_name"] = display_name[:120]
    async with httpx.AsyncClient(base_url=settings.backend_api_url, timeout=10.0) as client:
        response = await client.post(
            "/api/v1/internal/channel-links/activate",
            headers={"Authorization": f"Bearer {settings.backend_service_jwt}"},
            json=payload,
        )
    if response.status_code in (400, 404):
        return "invalid"
    if response.status_code == 409:
        return "conflict"
    response.raise_for_status()
    return "already_linked" if response.json().get("alreadyLinked") else "linked"


async def send_telegram_message(chat_id: int, text: str, *, settings: Settings | None = None) -> None:
    """Best-effort reply to a Telegram chat; failures are logged, never raised."""
    settings = settings or get_settings()
    if not settings.telegram_bot_token:
        return
    try:
        async with httpx.AsyncClient(base_url=TELEGRAM_API_BASE, timeout=10.0) as client:
            await client.post(
                f"/bot{settings.telegram_bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text},
            )
    except httpx.HTTPError:
        logger.warning("send_telegram_message: could not reply to chat %s", chat_id)


# ---------------------------------------------------------------------------
# Step 3: Media retrieval
# ---------------------------------------------------------------------------
async def download_media(
    channel: Channel | str,
    *,
    file_id: str,
    settings: Settings | None = None,
) -> bytes:
    """Download the raw voice-note bytes for the given channel.

    Blueprint §6 step 3:
      - Telegram: call `getFile` to resolve `file_id` -> `file_path`, then
        download from `https://api.telegram.org/file/bot<token>/<file_path>`.
      - WhatsApp: resolve the media ID via the Meta Graph API media endpoint
        (`GET /v21.0/<media_id>`, returns a short-lived `url`) and download
        immediately with a second authenticated GET — media IDs/URLs expire
        and must never be cached for later reuse.

    Enforces Whisper's 25MB limit (and Telegram's own 50MB download cap)
    using size metadata from the channel API where available, and always as
    a final check against the actually-downloaded byte count. Raises
    `MediaTooLargeError` (with a caller-facing `user_message`) rather than
    sending an oversized file on to transcription.
    """
    channel = Channel(channel) if not isinstance(channel, Channel) else channel
    settings = settings or get_settings()

    if channel is Channel.TELEGRAM:
        return await _download_telegram_media(file_id, settings=settings)
    if channel is Channel.WHATSAPP:
        return await _download_whatsapp_media(file_id, settings=settings)
    raise ValueError(f"download_media: unsupported channel {channel!r}")


def _enforce_size_limits(size_bytes: int) -> None:
    """Raise MediaTooLargeError if `size_bytes` exceeds either hard limit."""
    if size_bytes > TELEGRAM_MAX_BYTES:
        raise MediaTooLargeError(size_bytes, TELEGRAM_MAX_BYTES, "Telegram")
    if size_bytes > WHISPER_MAX_BYTES:
        raise MediaTooLargeError(size_bytes, WHISPER_MAX_BYTES, "Whisper")


async def _download_telegram_media(file_id: str, *, settings: Settings) -> bytes:
    """Telegram getFile + download (blueprint §6 step 3)."""
    if not settings.telegram_bot_token:
        raise MediaDownloadError("TELEGRAM_BOT_TOKEN is not configured")

    try:
        async with httpx.AsyncClient(base_url=TELEGRAM_API_BASE, timeout=30.0) as client:
            get_file_response = await client.get(
                f"/bot{settings.telegram_bot_token}/getFile",
                params={"file_id": file_id},
            )
            get_file_response.raise_for_status()
            body = get_file_response.json()
            if not body.get("ok"):
                raise MediaDownloadError(f"Telegram getFile returned an error: {body}")

            result = body.get("result", {})
            file_path = result.get("file_path")
            if not file_path:
                raise MediaDownloadError(
                    f"Telegram getFile response missing file_path: {body}"
                )

            file_size = result.get("file_size")
            if isinstance(file_size, int):
                _enforce_size_limits(file_size)

            download_response = await client.get(
                f"/file/bot{settings.telegram_bot_token}/{file_path}"
            )
            download_response.raise_for_status()
            content = download_response.content
    except httpx.HTTPError as exc:
        raise MediaDownloadError(f"Telegram media download failed: {exc}") from exc

    _enforce_size_limits(len(content))
    return content


async def _download_whatsapp_media(media_id: str, *, settings: Settings) -> bytes:
    """Meta Graph API media resolution + immediate download (blueprint §6 step 3).

    Media URLs are short-lived and tied to the app's access token - resolved
    and downloaded in the same call, never persisted for reuse.
    """
    if not settings.whatsapp_access_token:
        raise MediaDownloadError("WHATSAPP_ACCESS_TOKEN is not configured")

    headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            meta_response = await client.get(
                f"{WHATSAPP_GRAPH_API_BASE}/{media_id}", headers=headers
            )
            meta_response.raise_for_status()
            meta = meta_response.json()
            media_url = meta.get("url")
            if not media_url:
                raise MediaDownloadError(f"WhatsApp media metadata missing 'url': {meta}")

            file_size = meta.get("file_size")
            if isinstance(file_size, int):
                _enforce_size_limits(file_size)

            # Same bearer token authenticates the actual CDN download too, per
            # Meta's docs - a plain unauthenticated GET on `url` will 401.
            download_response = await client.get(media_url, headers=headers)
            download_response.raise_for_status()
            content = download_response.content
    except httpx.HTTPError as exc:
        raise MediaDownloadError(f"WhatsApp media download failed: {exc}") from exc

    _enforce_size_limits(len(content))
    return content


# ---------------------------------------------------------------------------
# Step 4-5: Transcoding + Transcription
# ---------------------------------------------------------------------------
async def _remux_to_wav(audio_bytes: bytes, tmp_dir: Path) -> Path:
    """Defensively remux arbitrary input audio to 16kHz mono WAV via ffmpeg.

    Whisper accepts ogg/opus directly, but voice notes arrive with varying
    (sometimes mislabeled) containers/codecs across Telegram and WhatsApp;
    normalizing through ffmpeg first is cheap insurance against edge-case
    decode failures on OpenAI's side. Raises TranscriptionError (with the
    tail of ffmpeg's stderr for diagnostics) if the subprocess fails.
    """
    input_path = tmp_dir / "input.audio"
    output_path = tmp_dir / "output.wav"
    input_path.write_bytes(audio_bytes)

    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",  # overwrite output.wav if it somehow already exists
            "-i",
            str(input_path),
            "-ar",
            "16000",  # Whisper's native sample rate
            "-ac",
            "1",  # mono
            str(output_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await process.communicate()
    except FileNotFoundError as exc:
        raise TranscriptionError(
            "ffmpeg executable not found - it must be installed in the "
            "container/host running this service"
        ) from exc

    if process.returncode != 0:
        stderr_tail = stderr.decode("utf-8", errors="replace")[-2000:]
        raise TranscriptionError(
            f"ffmpeg remux failed (exit code {process.returncode}): {stderr_tail}"
        )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise TranscriptionError("ffmpeg produced an empty or missing output file")

    return output_path


async def transcribe_audio(
    audio_bytes: bytes,
    *,
    mime_type: str,
    language: str | None = None,
    settings: Settings | None = None,
) -> str:
    """Transcode (if needed) and transcribe a voice note to text.

    Blueprint §6 step 4-5: defensively remux ogg/opus via ffmpeg before
    Whisper (even though Whisper accepts ogg/opus directly), enforce
    Whisper's 25MB limit upstream, then call `whisper-1`
    (upgrade path: `gpt-4o-transcribe`).

    Runs ffmpeg as a subprocess against temp files in a `TemporaryDirectory`,
    which is always cleaned up (success or failure) via the `with` block.
    """
    settings = settings or get_settings()
    if not settings.openai_api_key:
        raise TranscriptionError("OPENAI_API_KEY is not configured")

    # Belt-and-suspenders: download_media() already enforces this, but
    # transcribe_audio() is also callable directly (e.g. from tests or a
    # future retry path), so re-check here against Whisper's own limit.
    if len(audio_bytes) > WHISPER_MAX_BYTES:
        raise MediaTooLargeError(len(audio_bytes), WHISPER_MAX_BYTES, "Whisper")

    with tempfile.TemporaryDirectory(prefix="faktur-voice-") as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        wav_path = await _remux_to_wav(audio_bytes, tmp_dir)

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        try:
            with wav_path.open("rb") as wav_file:
                # A language hint (from the dashboard locale) keeps short
                # Czech/Slovak notes from being detected as another language.
                transcription = await client.audio.transcriptions.create(
                    model="whisper-1",
                    file=wav_file,
                    **({"language": language} if language else {}),
                )
        except TranscriptionError:
            raise
        except Exception as exc:  # openai raises its own exception hierarchy
            raise TranscriptionError(f"Whisper transcription call failed: {exc}") from exc

    text = (transcription.text or "").strip()
    if not text:
        raise EmptyTranscriptError("Whisper returned an empty transcript")
    return text


# ---------------------------------------------------------------------------
# Step 6: Structured extraction
# ---------------------------------------------------------------------------
async def extract_invoice_data(
    transcript: str,
    *,
    settings: Settings | None = None,
) -> ExtractedInvoiceDraft:
    """Extract structured invoice data from a transcript via GPT-4o.

    Blueprint §6 step 6: GPT-4o structured-output call
    (`response_format={"type": "json_schema", ...}`, OpenAI's current
    recommended mechanism for a guaranteed-shape JSON response, superseding
    plain function-calling for this use case) against a strict schema
    (counterparty name/IČO, line items, currency, due-date hint); validate
    with Pydantic, retry once on schema-validation failure.

    The `ExtractedInvoiceDraft` model itself (app/pipeline/schemas.py) is the
    real, validated contract for this step.
    """
    settings = settings or get_settings()
    if not settings.openai_api_key:
        raise ExtractionError("OPENAI_API_KEY is not configured")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    messages: list[dict] = [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": transcript},
    ]

    last_error: Exception | None = None
    for attempt in range(1, EXTRACTION_MAX_ATTEMPTS + 1):
        try:
            response = await client.chat.completions.create(
                model=EXTRACTION_MODEL,
                messages=messages,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "extracted_invoice_draft",
                        "strict": True,
                        "schema": EXTRACTION_JSON_SCHEMA,
                    },
                },
            )
        except Exception as exc:  # openai raises its own exception hierarchy
            raise ExtractionError(f"GPT-4o extraction call failed: {exc}") from exc

        raw_content = response.choices[0].message.content or ""
        try:
            data = json.loads(raw_content)
            return ExtractedInvoiceDraft.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = exc
            logger.warning(
                "extract_invoice_data: attempt %d/%d failed schema validation: %s",
                attempt,
                EXTRACTION_MAX_ATTEMPTS,
                exc,
            )
            if attempt < EXTRACTION_MAX_ATTEMPTS:
                # Retry once, feeding the model back its own broken output
                # plus the validation error so the retry can self-correct.
                messages.append({"role": "assistant", "content": raw_content})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "That response did not match the required JSON "
                            f"schema ({exc}). Return corrected JSON that "
                            "matches the schema exactly."
                        ),
                    }
                )

    raise ExtractionError(
        f"GPT-4o structured extraction failed schema validation after "
        f"{EXTRACTION_MAX_ATTEMPTS} attempts: {last_error}"
    )


# ---------------------------------------------------------------------------
# Step 7: ARES enrichment
# ---------------------------------------------------------------------------
async def enrich_with_ares(
    draft: ExtractedInvoiceDraft,
    *,
    settings: Settings | None = None,
) -> AresEnrichment:
    """Attempt to resolve/verify the counterparty against the ARES registry.

    Blueprint §6 step 7: resolve IČO through `packages/cz-compliance`'s
    cached ARES client, fronted by the backend's own endpoint; VAT-payer
    status is surfaced as "needs verification", never asserted outright (per
    the confirmed ARES/ADISREG gap, blueprint §1).

    ARES enrichment happens via the backend's own cached ARES client
    (`packages/cz-compliance`), NOT by duplicating an ARES HTTP client here
    in Python — the backend owns caching/throttling against ARES's
    undocumented rate limits. This calls
    `POST {BACKEND_API_URL}/api/v1/contacts/ares-lookup` with `{"ico": ...}`
    and the scoped `BACKEND_SERVICE_JWT`, and maps the response into
    `AresEnrichment`:
      - 200: a match was found - `matched_ico`/`matched_legal_name` are
        taken from the response body (tolerating either `legal_name` or the
        ARES-native `obchodni_jmeno` key, since the exact response shape is
        owned by a concurrently-developed backend endpoint).
      - 404: no business registered under that IČO -> NOT_FOUND.
      - 409: more than one candidate match -> AMBIGUOUS (never guess).
      - any other error status, a non-JSON body, or a network failure ->
        LOOKUP_FAILED, swallowed here rather than raised, so callers don't
        need a NotImplementedError-style except clause any more — the
        pipeline still proceeds to draft creation with `needs_attention=True`
        (blueprint §6 step 10) via orchestrate()'s existing status check.

    If no IČO was extracted at all, enrichment is skipped outright
    (SKIPPED_NO_ICO) rather than attempting a name-search - the backend
    endpoint's contract is IČO-only for now.
    """
    if not draft.counterparty_ico:
        return AresEnrichment(status=AresMatchStatus.SKIPPED_NO_ICO)

    settings = settings or get_settings()

    try:
        async with httpx.AsyncClient(base_url=settings.backend_api_url, timeout=10.0) as client:
            response = await client.post(
                "/api/v1/contacts/ares-lookup",
                headers={"Authorization": f"Bearer {settings.backend_service_jwt}"},
                json={"ico": draft.counterparty_ico},
            )
    except httpx.HTTPError as exc:
        logger.warning("enrich_with_ares: request to backend failed: %s", exc)
        return AresEnrichment(status=AresMatchStatus.LOOKUP_FAILED)

    if response.status_code == 404:
        return AresEnrichment(status=AresMatchStatus.NOT_FOUND)

    if response.status_code == 409:
        return AresEnrichment(status=AresMatchStatus.AMBIGUOUS)

    if response.status_code >= 400:
        logger.warning(
            "enrich_with_ares: backend returned %s: %s",
            response.status_code,
            response.text[:500],
        )
        return AresEnrichment(status=AresMatchStatus.LOOKUP_FAILED)

    try:
        body = response.json()
    except ValueError as exc:
        logger.warning("enrich_with_ares: backend returned a non-JSON body: %s", exc)
        return AresEnrichment(status=AresMatchStatus.LOOKUP_FAILED)

    confidence_raw = body.get("confidence", 1.0)
    try:
        confidence = float(confidence_raw) if confidence_raw is not None else 1.0
    except (TypeError, ValueError):
        confidence = 1.0

    return AresEnrichment(
        status=AresMatchStatus.MATCHED,
        matched_ico=body.get("ico") or draft.counterparty_ico,
        matched_legal_name=body.get("legal_name") or body.get("obchodni_jmeno"),
        # Never asserted outright, regardless of what the backend returns -
        # the confirmed ARES/ADISREG gap (blueprint §1) means VAT-payer
        # status must always read as "needs verification" in the dashboard.
        is_vat_payer=None,
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Step 8: Draft creation (never auto-finalize)
# ---------------------------------------------------------------------------
async def create_draft_invoice(
    tenant_id: str,
    draft: ExtractedInvoiceDraft,
    source: Channel | str,
    raw_transcript: str,
    *,
    ares_enrichment: AresEnrichment | None = None,
    ai_confidence_score: float = 0.0,
    needs_attention: bool = False,
    settings: Settings | None = None,
) -> httpx.Response:
    """POST a pending_review draft to the backend. NEVER calls issue/finalize.

    Blueprint §6 step 8 / §9: `POST /api/v1/invoices/drafts` creates
    `status = pending_review`, storing the raw transcript + extracted JSON +
    ARES match confidence. No invoice number is allocated here — CZ/SK law
    requires immutable sequential numbering only at issue time, and human
    confirmation before issuance is non-negotiable.

    This is a real implementation: it builds the DraftInvoicePayload DTO and
    posts it with the scoped service JWT as Bearer auth.
    """
    settings = settings or get_settings()
    payload = DraftInvoicePayload(
        tenant_id=tenant_id,
        source=Channel(source) if not isinstance(source, Channel) else source,
        raw_transcript=raw_transcript,
        extracted_data=draft,
        ares_enrichment=ares_enrichment,
        ai_confidence_score=ai_confidence_score,
        needs_attention=needs_attention,
    )

    async with httpx.AsyncClient(base_url=settings.backend_api_url, timeout=15.0) as client:
        response = await client.post(
            "/api/v1/invoices/drafts",
            headers={"Authorization": f"Bearer {settings.backend_service_jwt}"},
            json=payload.model_dump(mode="json"),
        )
    return response


# ---------------------------------------------------------------------------
# Orchestration: ties all steps together in §6 order
# ---------------------------------------------------------------------------
async def orchestrate(
    *,
    channel: Channel,
    external_user_id: str,
    file_id: str,
    mime_type: str,
    settings: Settings | None = None,
) -> httpx.Response | None:
    """Run the full voice-to-invoice pipeline for one inbound voice message.

    Mirrors blueprint §6 step-by-step. Returns the backend's draft-creation
    response, or None if the sender could not be resolved to a tenant (in
    which case the caller — the webhook handler — is responsible for sending
    onboarding instructions back to the user).
    """
    settings = settings or get_settings()

    # Step 2: tenant resolution / account linking. Unlinked senders are
    # always rejected, never processed.
    tenant_id = await resolve_tenant(channel, external_user_id, settings=settings)
    if tenant_id is None:
        logger.info(
            "orchestrate: no tenant linked for channel=%s external_user_id=%s "
            "- rejecting message, caller should send onboarding instructions",
            channel,
            external_user_id,
        )
        return None

    # Step 3: media retrieval (download the voice note bytes).
    audio_bytes = await download_media(channel, file_id=file_id, settings=settings)

    # Steps 4-5: transcoding + transcription (Whisper).
    transcript = await transcribe_audio(audio_bytes, mime_type=mime_type, settings=settings)

    # Step 6: structured extraction (GPT-4o), Pydantic-validated.
    extracted = await extract_invoice_data(transcript, settings=settings)

    # Step 7: ARES enrichment - never asserts VAT-payer status outright.
    # enrich_with_ares() itself already swallows httpx/network/backend-error
    # failures into AresMatchStatus.LOOKUP_FAILED (see its docstring), so the
    # only exceptions that can still reach here are genuinely unexpected
    # bugs - caught defensively so a backend hiccup never drops the message
    # (step 10: always produce a draft, flagged needs_attention, rather than
    # silently failing).
    needs_attention = False
    try:
        ares_enrichment = await enrich_with_ares(extracted, settings=settings)
        if ares_enrichment.status in (
            AresMatchStatus.NOT_FOUND,
            AresMatchStatus.AMBIGUOUS,
            AresMatchStatus.LOOKUP_FAILED,
        ):
            # Step 10: failed ARES lookups still produce a draft, flagged
            # needs_attention, rather than silently failing.
            needs_attention = True
    except Exception:
        logger.exception("orchestrate: ARES enrichment raised unexpectedly, flagging needs_attention")
        ares_enrichment = None
        needs_attention = True

    # Step 8: draft creation only, status=pending_review, never auto-finalize.
    response = await create_draft_invoice(
        tenant_id,
        extracted,
        channel,
        transcript,
        ares_enrichment=ares_enrichment,
        ai_confidence_score=0.0,  # TODO: surface GPT-4o's own confidence once implemented
        needs_attention=needs_attention,
        settings=settings,
    )

    # Step 9 ("Issue" triggers finalize) intentionally happens ONLY in the
    # dashboard, driven by a human. This service must never call it.

    return response
