"""Tests for `POST /internal/transcribe` (dashboard voice notes via the backend).

`transcribe_audio` is patched, so no ffmpeg or OpenAI call happens. Covers the
token check (including the "unset token refuses everything" rule) and how
pipeline errors map to the status codes the backend relies on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import get_settings
from app.pipeline.errors import EmptyTranscriptError, MediaTooLargeError, TranscriptionError
from app.webhooks import internal as internal_module

TOKEN = "test-internal-token"


@pytest.fixture(autouse=True)
def _configured_token(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_INTERNAL_TOKEN", TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(main.app)


def _post(client: TestClient, *, token: str | None = TOKEN, content_type: str = "audio/webm;codecs=opus", body: bytes = b"audio", params=None):
    headers = {"Content-Type": content_type}
    if token is not None:
        headers["X-Internal-Token"] = token
    return client.post("/internal/transcribe", content=body, headers=headers, params=params)


def _fake_transcribe(result=None, exc: Exception | None = None):
    calls: list[dict] = []

    async def fake(audio_bytes, *, mime_type, language=None, settings=None):
        calls.append({"audio": audio_bytes, "mime_type": mime_type, "language": language})
        if exc is not None:
            raise exc
        return result

    return fake, calls


def test_returns_transcript_and_passes_type_and_language(client, monkeypatch):
    fake, calls = _fake_transcribe("Faktura pro Alza, 3 hodiny konzultace")
    monkeypatch.setattr(internal_module, "transcribe_audio", fake)

    res = _post(client, params={"language": "cs"})

    assert res.status_code == 200
    assert res.json() == {"transcript": "Faktura pro Alza, 3 hodiny konzultace"}
    assert calls == [{"audio": b"audio", "mime_type": "audio/webm", "language": "cs"}]


def test_unknown_language_is_dropped(client, monkeypatch):
    fake, calls = _fake_transcribe("text")
    monkeypatch.setattr(internal_module, "transcribe_audio", fake)

    _post(client, params={"language": "xx"})

    assert calls[0]["language"] is None


@pytest.mark.parametrize("token", [None, "wrong"])
def test_rejects_missing_or_wrong_token(client, monkeypatch, token):
    fake, calls = _fake_transcribe("text")
    monkeypatch.setattr(internal_module, "transcribe_audio", fake)

    assert _post(client, token=token).status_code == 401
    assert calls == []


def test_unset_token_refuses_everything(client, monkeypatch):
    monkeypatch.setenv("AI_SERVICE_INTERNAL_TOKEN", "")
    get_settings.cache_clear()

    assert _post(client, token="").status_code == 401


def test_rejects_non_audio(client):
    assert _post(client, content_type="application/json").status_code == 415


def test_rejects_empty_body(client):
    assert _post(client, body=b"").status_code == 422


@pytest.mark.parametrize(
    ("exc", "status"),
    [
        (EmptyTranscriptError("Whisper returned an empty transcript"), 422),
        (MediaTooLargeError(30_000_000, 25 * 1024 * 1024, "Whisper"), 413),
        (TranscriptionError("ffmpeg remux failed"), 502),
    ],
)
def test_maps_pipeline_errors(client, monkeypatch, exc, status):
    fake, _ = _fake_transcribe(exc=exc)
    monkeypatch.setattr(internal_module, "transcribe_audio", fake)

    res = _post(client)

    assert res.status_code == status
    assert "ffmpeg" not in res.text
