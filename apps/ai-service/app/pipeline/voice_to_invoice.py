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
    - download_media: STUB (TODO) — per-channel media download.
    - transcribe_audio: STUB (TODO) — would call OpenAI Whisper.
    - extract_invoice_data: STUB (TODO) — would call GPT-4o structured
      extraction; the *schema* it returns (ExtractedInvoiceDraft) is real.
    - enrich_with_ares: STUB (TODO) — calls an as-yet-unimplemented backend
      endpoint (see function docstring).
    - create_draft_invoice: REAL — posts the draft to the backend with the
      scoped service JWT.
    - orchestrate: REAL — wires the above together in §6's step order.
"""

from __future__ import annotations

import logging

import httpx

from app.config import Settings, get_settings
from app.pipeline.schemas import (
    AresEnrichment,
    AresMatchStatus,
    Channel,
    DraftInvoicePayload,
    ExtractedInvoiceDraft,
)

logger = logging.getLogger(__name__)


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
    backend's `POST /api/v1/channel-links/verify` endpoint, which is the
    single source of truth for the `channel_links` table (tenant isolation
    lives in the backend/DB, not here).

    Returns:
        The tenant_id (as a string UUID) if the sender is linked and active,
        otherwise None.
    """
    settings = settings or get_settings()
    async with httpx.AsyncClient(base_url=settings.backend_api_url, timeout=10.0) as client:
        response = await client.post(
            "/api/v1/channel-links/verify",
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
    return body.get("tenant_id")


# ---------------------------------------------------------------------------
# Step 3: Media retrieval
# ---------------------------------------------------------------------------
async def download_media(
    channel: Channel,
    *,
    file_id: str,
    settings: Settings | None = None,
) -> bytes:
    """Download the raw voice-note bytes for the given channel.

    Blueprint §6 step 3:
      - Telegram: call `getFile` to resolve `file_id` -> `file_path`, then
        download from `https://api.telegram.org/file/bot<token>/<file_path>`.
      - WhatsApp: resolve the media ID via the Meta Media endpoint and
        download immediately — media IDs expire after 7 days and must never
        be cached for later reuse.

    TODO: implement both branches. Left unimplemented because it requires a
    live bot token / WhatsApp access token and network access not needed to
    validate the pipeline's structure.
    """
    raise NotImplementedError(
        "download_media: TODO - implement Telegram getFile+download and "
        "WhatsApp media-endpoint download (blueprint §6 step 3)."
    )


# ---------------------------------------------------------------------------
# Step 4-5: Transcoding + Transcription
# ---------------------------------------------------------------------------
async def transcribe_audio(
    audio_bytes: bytes,
    *,
    mime_type: str,
    settings: Settings | None = None,
) -> str:
    """Transcode (if needed) and transcribe a voice note to text.

    Blueprint §6 step 4-5: defensively remux ogg/opus via ffmpeg before
    Whisper (even though Whisper accepts ogg/opus directly), enforce
    Whisper's 25MB / Telegram's 50MB limits upstream, then call `whisper-1`
    (upgrade path: `gpt-4o-transcribe`).

    TODO: implement ffmpeg remux + OpenAI Whisper call. Stubbed because it
    requires a live OPENAI_API_KEY and the `openai` SDK call.
    """
    raise NotImplementedError(
        "transcribe_audio: TODO - implement ffmpeg transcode + OpenAI "
        "whisper-1 transcription call (blueprint §6 step 4-5)."
    )


# ---------------------------------------------------------------------------
# Step 6: Structured extraction
# ---------------------------------------------------------------------------
async def extract_invoice_data(
    transcript: str,
    *,
    settings: Settings | None = None,
) -> ExtractedInvoiceDraft:
    """Extract structured invoice data from a transcript via GPT-4o.

    Blueprint §6 step 6: GPT-4o function-calling/structured output against a
    strict schema (counterparty name/IČO, line items, currency, due-date
    hint); validate with Pydantic, retry once on schema failure.

    The `ExtractedInvoiceDraft` model itself (app/pipeline/schemas.py) is the
    real, validated contract for this step. The OpenAI call is stubbed.

    TODO: implement the GPT-4o structured-output call + one retry-on-
    validation-failure. Stubbed because it requires a live OPENAI_API_KEY.
    """
    raise NotImplementedError(
        "extract_invoice_data: TODO - implement GPT-4o structured extraction "
        "call, validated into ExtractedInvoiceDraft, with one retry on "
        "schema-validation failure (blueprint §6 step 6)."
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

    Blueprint §6 step 7: resolve IČO (or search by name) through
    `packages/cz-compliance`'s cached ARES client; VAT-payer status is
    surfaced as "needs verification", never asserted outright (per the
    confirmed ARES/ADISREG gap, blueprint §1).

    NOTE: ARES enrichment should ideally happen via the backend's own cached
    ARES client (`packages/cz-compliance`), NOT by duplicating an ARES HTTP
    client here in Python — the backend already owns caching/throttling
    against ARES's undocumented rate limits. For this MVP stub we call an
    *implied* backend endpoint, `{BACKEND_API_URL}/api/v1/contacts/ares-lookup`,
    which does not exist yet — the backend team needs to expose it. Do not
    implement it here or in apps/backend from this service.

    TODO: once that backend endpoint exists, implement the httpx call and
    map its response into AresEnrichment.
    """
    if not draft.counterparty_ico:
        return AresEnrichment(status=AresMatchStatus.SKIPPED_NO_ICO)

    raise NotImplementedError(
        "enrich_with_ares: TODO - call "
        "'{BACKEND_API_URL}/api/v1/contacts/ares-lookup' (backend endpoint "
        "not yet implemented) via httpx and map the response into "
        "AresEnrichment (blueprint §6 step 7)."
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
    except NotImplementedError:
        # ARES enrichment backend endpoint doesn't exist yet (see
        # enrich_with_ares docstring) - still proceed to draft creation with
        # needs_attention=True rather than dropping the message (step 10).
        logger.warning("orchestrate: ARES enrichment not available yet, flagging needs_attention")
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
