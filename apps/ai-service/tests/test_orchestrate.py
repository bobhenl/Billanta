"""Unit tests for orchestrate() wiring (blueprint §6 step order + step 10).

Every pipeline step is monkeypatched at the module level so this only tests
orchestrate()'s own control flow: that an unlinked sender short-circuits
before any media/AI calls, and that an unexpected exception from
enrich_with_ares() is swallowed into a needs_attention draft rather than
aborting the whole pipeline (step 10 - never silently drop a message).

NOT covered here: the individual steps' own real logic (see
test_download_media.py, test_transcribe_audio.py,
test_extract_invoice_data.py, test_enrich_with_ares.py).
"""

from __future__ import annotations

import httpx

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.schemas import (
    AresEnrichment,
    AresMatchStatus,
    Channel,
    ExtractedInvoiceDraft,
)


async def test_orchestrate_returns_none_for_unlinked_sender(monkeypatch, settings):
    async def fake_resolve_tenant(*args, **kwargs):
        return None

    called = {"download_media": False}

    async def fake_download_media(*args, **kwargs):
        called["download_media"] = True
        return b""

    monkeypatch.setattr(v2i, "resolve_tenant", fake_resolve_tenant)
    monkeypatch.setattr(v2i, "download_media", fake_download_media)

    result = await v2i.orchestrate(
        channel=Channel.TELEGRAM,
        external_user_id="123",
        file_id="file-1",
        mime_type="audio/ogg",
        settings=settings,
    )

    assert result is None
    assert called["download_media"] is False, "must never touch media for an unlinked sender"


async def test_orchestrate_flags_needs_attention_when_ares_raises_unexpectedly(monkeypatch, settings):
    draft = ExtractedInvoiceDraft(counterparty_name_raw="Jan Novák", counterparty_ico="12345678")

    async def fake_resolve_tenant(*args, **kwargs):
        return "tenant-1"

    async def fake_download_media(*args, **kwargs):
        return b"audio-bytes"

    async def fake_transcribe_audio(*args, **kwargs):
        return "transcript text"

    async def fake_extract_invoice_data(*args, **kwargs):
        return draft

    async def fake_enrich_with_ares(*args, **kwargs):
        raise RuntimeError("totally unexpected bug")

    captured_kwargs = {}

    async def fake_create_draft_invoice(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return httpx.Response(201, request=httpx.Request("POST", "https://example.test"))

    monkeypatch.setattr(v2i, "resolve_tenant", fake_resolve_tenant)
    monkeypatch.setattr(v2i, "download_media", fake_download_media)
    monkeypatch.setattr(v2i, "transcribe_audio", fake_transcribe_audio)
    monkeypatch.setattr(v2i, "extract_invoice_data", fake_extract_invoice_data)
    monkeypatch.setattr(v2i, "enrich_with_ares", fake_enrich_with_ares)
    monkeypatch.setattr(v2i, "create_draft_invoice", fake_create_draft_invoice)

    response = await v2i.orchestrate(
        channel=Channel.TELEGRAM,
        external_user_id="123",
        file_id="file-1",
        mime_type="audio/ogg",
        settings=settings,
    )

    assert response.status_code == 201
    assert captured_kwargs["needs_attention"] is True
    assert captured_kwargs["ares_enrichment"] is None


async def test_orchestrate_flags_needs_attention_on_ares_lookup_failed_status(monkeypatch, settings):
    draft = ExtractedInvoiceDraft(counterparty_name_raw="Jan Novák", counterparty_ico="12345678")

    async def fake_resolve_tenant(*args, **kwargs):
        return "tenant-1"

    async def fake_download_media(*args, **kwargs):
        return b"audio-bytes"

    async def fake_transcribe_audio(*args, **kwargs):
        return "transcript text"

    async def fake_extract_invoice_data(*args, **kwargs):
        return draft

    async def fake_enrich_with_ares(*args, **kwargs):
        return AresEnrichment(status=AresMatchStatus.LOOKUP_FAILED)

    captured_kwargs = {}

    async def fake_create_draft_invoice(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return httpx.Response(201, request=httpx.Request("POST", "https://example.test"))

    monkeypatch.setattr(v2i, "resolve_tenant", fake_resolve_tenant)
    monkeypatch.setattr(v2i, "download_media", fake_download_media)
    monkeypatch.setattr(v2i, "transcribe_audio", fake_transcribe_audio)
    monkeypatch.setattr(v2i, "extract_invoice_data", fake_extract_invoice_data)
    monkeypatch.setattr(v2i, "enrich_with_ares", fake_enrich_with_ares)
    monkeypatch.setattr(v2i, "create_draft_invoice", fake_create_draft_invoice)

    await v2i.orchestrate(
        channel=Channel.TELEGRAM,
        external_user_id="123",
        file_id="file-1",
        mime_type="audio/ogg",
        settings=settings,
    )

    assert captured_kwargs["needs_attention"] is True


async def test_orchestrate_no_needs_attention_on_clean_match(monkeypatch, settings):
    draft = ExtractedInvoiceDraft(counterparty_name_raw="Jan Novák", counterparty_ico="12345678")

    async def fake_resolve_tenant(*args, **kwargs):
        return "tenant-1"

    async def fake_download_media(*args, **kwargs):
        return b"audio-bytes"

    async def fake_transcribe_audio(*args, **kwargs):
        return "transcript text"

    async def fake_extract_invoice_data(*args, **kwargs):
        return draft

    async def fake_enrich_with_ares(*args, **kwargs):
        return AresEnrichment(status=AresMatchStatus.MATCHED, matched_ico="12345678", confidence=1.0)

    captured_kwargs = {}

    async def fake_create_draft_invoice(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return httpx.Response(201, request=httpx.Request("POST", "https://example.test"))

    monkeypatch.setattr(v2i, "resolve_tenant", fake_resolve_tenant)
    monkeypatch.setattr(v2i, "download_media", fake_download_media)
    monkeypatch.setattr(v2i, "transcribe_audio", fake_transcribe_audio)
    monkeypatch.setattr(v2i, "extract_invoice_data", fake_extract_invoice_data)
    monkeypatch.setattr(v2i, "enrich_with_ares", fake_enrich_with_ares)
    monkeypatch.setattr(v2i, "create_draft_invoice", fake_create_draft_invoice)

    await v2i.orchestrate(
        channel=Channel.TELEGRAM,
        external_user_id="123",
        file_id="file-1",
        mime_type="audio/ogg",
        settings=settings,
    )

    assert captured_kwargs["needs_attention"] is False
