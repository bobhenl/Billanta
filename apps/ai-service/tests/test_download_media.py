"""Unit tests for download_media() (blueprint §6 step 3).

All httpx traffic is faked via a minimal in-process stand-in for
`httpx.AsyncClient` (`FakeAsyncClient` below) that returns pre-built
`httpx.Response` objects — no real network calls are made, and no live
Telegram bot token / WhatsApp access token is required or used.

This verifies: correct URL construction for both channels, size-limit
enforcement from API-reported metadata *and* from the actual downloaded
byte count, and mapping of channel-API/network failures to
`MediaDownloadError`.

NOT covered here (needs live credentials, out of scope for unit tests):
whether Telegram's/Meta's real APIs actually behave as documented.
"""

from __future__ import annotations

from typing import Self

import httpx
import pytest

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.errors import MediaDownloadError, MediaTooLargeError

DUMMY_REQUEST = httpx.Request("GET", "https://example.test")


def _response(status_code: int, *, json=None, content: bytes | None = None) -> httpx.Response:
    kwargs = {}
    if json is not None:
        kwargs["json"] = json
    if content is not None:
        kwargs["content"] = content
    return httpx.Response(status_code, request=DUMMY_REQUEST, **kwargs)


class FakeAsyncClient:
    """Stand-in for httpx.AsyncClient: returns canned responses in order."""

    def __init__(self, responses: list[httpx.Response | Exception], **_kwargs) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict]] = []

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc_info) -> bool:
        return False

    async def _next(self, method: str, url: str, **kwargs) -> httpx.Response:
        self.calls.append((method, url, kwargs))
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def get(self, url: str, **kwargs) -> httpx.Response:
        return await self._next("GET", url, **kwargs)

    async def post(self, url: str, **kwargs) -> httpx.Response:
        return await self._next("POST", url, **kwargs)


def _patch_client(monkeypatch, responses: list[httpx.Response | Exception]) -> FakeAsyncClient:
    fake = FakeAsyncClient(responses)
    monkeypatch.setattr(v2i.httpx, "AsyncClient", lambda *a, **k: fake)
    return fake


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
async def test_telegram_download_success(monkeypatch, settings):
    get_file_resp = _response(
        200,
        json={"ok": True, "result": {"file_path": "voice/file_1.oga", "file_size": 1234}},
    )
    download_resp = _response(200, content=b"OggS-fake-audio-bytes")
    fake = _patch_client(monkeypatch, [get_file_resp, download_resp])

    result = await v2i.download_media(
        v2i.Channel.TELEGRAM, file_id="abc123", settings=settings
    )

    assert result == b"OggS-fake-audio-bytes"
    assert fake.calls[0][0] == "GET"
    assert fake.calls[0][1] == f"/bot{settings.telegram_bot_token}/getFile"
    assert fake.calls[0][2]["params"] == {"file_id": "abc123"}
    assert fake.calls[1][1] == f"/file/bot{settings.telegram_bot_token}/voice/file_1.oga"


async def test_telegram_download_rejects_oversized_metadata(monkeypatch, settings):
    get_file_resp = _response(
        200,
        json={
            "ok": True,
            "result": {"file_path": "voice/big.oga", "file_size": v2i.WHISPER_MAX_BYTES + 1},
        },
    )
    _patch_client(monkeypatch, [get_file_resp])

    with pytest.raises(MediaTooLargeError) as exc_info:
        await v2i.download_media(v2i.Channel.TELEGRAM, file_id="abc123", settings=settings)

    assert exc_info.value.limit_name == "Whisper"
    assert "too large" in exc_info.value.user_message


async def test_telegram_download_rejects_oversized_actual_bytes(monkeypatch, settings):
    # No file_size in metadata (Telegram doesn't always report it) - the
    # actually-downloaded byte count must still be enforced.
    get_file_resp = _response(
        200, json={"ok": True, "result": {"file_path": "voice/big.oga"}}
    )
    oversized_content = b"x" * (v2i.WHISPER_MAX_BYTES + 1)
    download_resp = _response(200, content=oversized_content)
    _patch_client(monkeypatch, [get_file_resp, download_resp])

    with pytest.raises(MediaTooLargeError):
        await v2i.download_media(v2i.Channel.TELEGRAM, file_id="abc123", settings=settings)


def test_telegram_download_rejects_above_telegram_cap():
    # A file_size beyond Telegram's own 50MB cap should raise with that
    # limit named, not Whisper's - sanity-check limit ordering logic.
    with pytest.raises(MediaTooLargeError) as exc_info:
        v2i._enforce_size_limits(v2i.TELEGRAM_MAX_BYTES + 1)
    assert exc_info.value.limit_name == "Telegram"


async def test_telegram_download_not_ok_raises_media_download_error(monkeypatch, settings):
    get_file_resp = _response(200, json={"ok": False, "description": "file not found"})
    _patch_client(monkeypatch, [get_file_resp])

    with pytest.raises(MediaDownloadError):
        await v2i.download_media(v2i.Channel.TELEGRAM, file_id="missing", settings=settings)


async def test_telegram_download_network_error_raises_media_download_error(monkeypatch, settings):
    _patch_client(monkeypatch, [httpx.ConnectError("boom", request=DUMMY_REQUEST)])

    with pytest.raises(MediaDownloadError):
        await v2i.download_media(v2i.Channel.TELEGRAM, file_id="abc123", settings=settings)


async def test_telegram_download_missing_token_raises(settings):
    settings.telegram_bot_token = ""
    with pytest.raises(MediaDownloadError):
        await v2i.download_media(v2i.Channel.TELEGRAM, file_id="abc123", settings=settings)


# ---------------------------------------------------------------------------
# WhatsApp
# ---------------------------------------------------------------------------
async def test_whatsapp_download_success(monkeypatch, settings):
    meta_resp = _response(
        200,
        json={
            "url": "https://lookaside.fbsbx.com/whatsapp_business/media/fake",
            "mime_type": "audio/ogg",
            "file_size": 4321,
            "id": "media-id-1",
        },
    )
    download_resp = _response(200, content=b"whatsapp-audio-bytes")
    fake = _patch_client(monkeypatch, [meta_resp, download_resp])

    result = await v2i.download_media(
        v2i.Channel.WHATSAPP, file_id="media-id-1", settings=settings
    )

    assert result == b"whatsapp-audio-bytes"
    assert fake.calls[0][1] == f"{v2i.WHATSAPP_GRAPH_API_BASE}/media-id-1"
    assert fake.calls[0][2]["headers"]["Authorization"] == f"Bearer {settings.whatsapp_access_token}"
    assert fake.calls[1][1] == "https://lookaside.fbsbx.com/whatsapp_business/media/fake"


async def test_whatsapp_download_missing_url_raises(monkeypatch, settings):
    meta_resp = _response(200, json={"mime_type": "audio/ogg", "file_size": 100})
    _patch_client(monkeypatch, [meta_resp])

    with pytest.raises(MediaDownloadError):
        await v2i.download_media(v2i.Channel.WHATSAPP, file_id="media-id-1", settings=settings)


async def test_whatsapp_download_rejects_oversized_metadata(monkeypatch, settings):
    meta_resp = _response(
        200,
        json={"url": "https://cdn.test/x", "file_size": v2i.WHISPER_MAX_BYTES + 1},
    )
    _patch_client(monkeypatch, [meta_resp])

    with pytest.raises(MediaTooLargeError):
        await v2i.download_media(v2i.Channel.WHATSAPP, file_id="media-id-1", settings=settings)


async def test_whatsapp_download_missing_access_token_raises(settings):
    settings.whatsapp_access_token = ""
    with pytest.raises(MediaDownloadError):
        await v2i.download_media(v2i.Channel.WHATSAPP, file_id="media-id-1", settings=settings)


async def test_download_media_unsupported_channel_raises(settings):
    with pytest.raises(ValueError):
        await v2i.download_media("carrier-pigeon", file_id="x", settings=settings)  # type: ignore[arg-type]
