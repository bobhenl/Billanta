"""Unit tests for enrich_with_ares() (blueprint §6 step 7).

httpx traffic to the backend's `/api/v1/contacts/ares-lookup` endpoint is
faked (no real backend call), since that endpoint is being built by a
concurrent workstream and doesn't exist yet in this environment. This
verifies: the request shape (IČO in the body, scoped JWT in the header), the
SKIPPED_NO_ICO short-circuit, and every documented response-status mapping
(200/404/409/5xx/non-JSON/network-error) — including that `is_vat_payer` is
*always* None regardless of what the backend returns, per the blueprint's
ARES/ADISREG confidence rule.

NOT covered here (the real backend endpoint doesn't exist yet in this
environment): whether its actual response shape matches what's assumed here
(`legal_name` / `obchodni_jmeno` / `confidence` / `ico` keys) — this will
need a quick contract check once that endpoint lands.
"""

from __future__ import annotations

import httpx

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.schemas import AresMatchStatus, ExtractedInvoiceDraft

DUMMY_REQUEST = httpx.Request("POST", "https://example.test")


def _response(status_code: int, *, json=None, content: bytes | None = None) -> httpx.Response:
    kwargs = {}
    if json is not None:
        kwargs["json"] = json
    if content is not None:
        kwargs["content"] = content
    return httpx.Response(status_code, request=DUMMY_REQUEST, **kwargs)


class FakeAsyncClient:
    def __init__(self, responses, **_kwargs):
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _patch_client(monkeypatch, responses):
    fake = FakeAsyncClient(responses)
    monkeypatch.setattr(v2i.httpx, "AsyncClient", lambda *a, **k: fake)
    return fake


def _draft(ico: str | None = "12345678") -> ExtractedInvoiceDraft:
    return ExtractedInvoiceDraft(counterparty_name_raw="Jan Novák", counterparty_ico=ico)


async def test_enrich_skips_when_no_ico(settings):
    result = await v2i.enrich_with_ares(_draft(ico=None), settings=settings)
    assert result.status == AresMatchStatus.SKIPPED_NO_ICO


async def test_enrich_matched_maps_legal_name(monkeypatch, settings):
    fake = _patch_client(
        monkeypatch,
        [_response(200, json={"ico": "12345678", "legal_name": "Jan Novák s.r.o.", "confidence": 0.95})],
    )

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.MATCHED
    assert result.matched_ico == "12345678"
    assert result.matched_legal_name == "Jan Novák s.r.o."
    assert result.confidence == 0.95
    assert result.is_vat_payer is None  # never asserted outright

    call = fake.calls[0]
    assert call[1] == "/api/v1/contacts/ares-lookup"
    assert call[2]["json"] == {"ico": "12345678"}
    assert call[2]["headers"]["Authorization"] == f"Bearer {settings.backend_service_jwt}"


async def test_enrich_matched_tolerates_ares_native_key(monkeypatch, settings):
    _patch_client(
        monkeypatch,
        [_response(200, json={"obchodni_jmeno": "Jan Novák s.r.o."})],
    )

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.MATCHED
    assert result.matched_legal_name == "Jan Novák s.r.o."
    assert result.confidence == 1.0  # default when the backend omits it
    assert result.is_vat_payer is None


async def test_enrich_not_found(monkeypatch, settings):
    _patch_client(monkeypatch, [_response(404, json={"detail": "not found"})])

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.NOT_FOUND


async def test_enrich_ambiguous(monkeypatch, settings):
    _patch_client(monkeypatch, [_response(409, json={"detail": "multiple candidates"})])

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.AMBIGUOUS


async def test_enrich_server_error_maps_to_lookup_failed(monkeypatch, settings):
    _patch_client(monkeypatch, [_response(500, content=b"internal error")])

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.LOOKUP_FAILED


async def test_enrich_non_json_body_maps_to_lookup_failed(monkeypatch, settings):
    _patch_client(monkeypatch, [_response(200, content=b"<html>not json</html>")])

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.LOOKUP_FAILED


async def test_enrich_network_error_maps_to_lookup_failed(monkeypatch, settings):
    _patch_client(monkeypatch, [httpx.ConnectError("boom", request=DUMMY_REQUEST)])

    result = await v2i.enrich_with_ares(_draft(), settings=settings)

    assert result.status == AresMatchStatus.LOOKUP_FAILED
