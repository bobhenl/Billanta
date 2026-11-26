"""Unit tests for resolve_tenant() (blueprint §6 step 2).

httpx traffic to the backend's `/api/v1/internal/channel-links/verify`
endpoint is faked. This verifies the 404 -> unlinked mapping and that the
tenant's country and home currency are read from the response, falling back
to CZ/CZK for backends that only send the tenant id.
"""

from __future__ import annotations

import httpx

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.schemas import Channel, TenantContext

DUMMY_REQUEST = httpx.Request("POST", "https://example.test")


class FakeAsyncClient:
    def __init__(self, response: httpx.Response):
        self._response = response
        self.calls: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self._response


def _patch_client(monkeypatch, status_code: int, json=None) -> FakeAsyncClient:
    fake = FakeAsyncClient(httpx.Response(status_code, request=DUMMY_REQUEST, json=json))
    monkeypatch.setattr(v2i.httpx, "AsyncClient", lambda *a, **k: fake)
    return fake


async def test_resolve_tenant_returns_none_for_unlinked_sender(monkeypatch, settings):
    _patch_client(monkeypatch, 404, json={"message": "No active channel link"})

    assert await v2i.resolve_tenant(Channel.TELEGRAM, "123", settings=settings) is None


async def test_resolve_tenant_reads_country_and_home_currency(monkeypatch, settings):
    fake = _patch_client(
        monkeypatch, 200, json={"tenantId": "t-sk", "country": "SK", "homeCurrency": "EUR"}
    )

    tenant = await v2i.resolve_tenant(Channel.TELEGRAM, "123", settings=settings)

    assert tenant == TenantContext(tenant_id="t-sk", country="SK", home_currency="EUR")
    url, kwargs = fake.calls[0]
    assert url == "/api/v1/internal/channel-links/verify"
    assert kwargs["headers"]["Authorization"] == "Bearer test-backend-jwt"


async def test_resolve_tenant_falls_back_to_cz_for_old_backends(monkeypatch, settings):
    _patch_client(monkeypatch, 200, json={"tenantId": "t-old"})

    tenant = await v2i.resolve_tenant(Channel.TELEGRAM, "123", settings=settings)

    assert tenant == TenantContext(tenant_id="t-old", country="CZ", home_currency="CZK")
