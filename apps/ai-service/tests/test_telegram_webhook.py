"""Unit tests for the Telegram webhook's pipeline-error handling.

Verifies that when orchestrate() raises a PipelineError (e.g. oversized
media, transcription/extraction failure) or any other unexpected exception,
the webhook still acknowledges Telegram with `{"ok": True}` / HTTP 200
rather than 500ing (which would make Telegram retry-storm the same failing
update) - it just logs instead. Secret-token verification itself predates
this change and is exercised here only incidentally.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import get_settings
from app.pipeline.errors import MediaTooLargeError
from app.pipeline.voice_to_invoice import (
    orchestrate,  # noqa: F401  (patched via app.webhooks.telegram)
)
from app.webhooks import telegram as telegram_webhook_module

WEBHOOK_SECRET = "test-webhook-secret"

VOICE_UPDATE = {
    "update_id": 1,
    "message": {
        "message_id": 10,
        "date": 1700000000,
        "chat": {"id": 555, "type": "private"},
        "from": {"id": 555, "is_bot": False, "first_name": "Jan"},
        "voice": {
            "file_id": "abc123",
            "file_unique_id": "uniq1",
            "duration": 5,
            "mime_type": "audio/ogg",
            "file_size": 12345,
        },
    },
}


@pytest.fixture(autouse=True)
def _configured_webhook_secret(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(main.app)


def _post_update(client: TestClient, update: dict = VOICE_UPDATE):
    return client.post(
        "/webhook/telegram",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET},
    )


def test_webhook_acks_ok_when_pipeline_raises_media_too_large(monkeypatch, client):
    async def fake_orchestrate(**kwargs):
        raise MediaTooLargeError(30_000_000, 25_000_000, "Whisper")

    monkeypatch.setattr(telegram_webhook_module, "orchestrate", fake_orchestrate)

    response = _post_update(client)

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_webhook_acks_ok_when_pipeline_raises_unexpected_error(monkeypatch, client):
    async def fake_orchestrate(**kwargs):
        raise RuntimeError("totally unexpected")

    monkeypatch.setattr(telegram_webhook_module, "orchestrate", fake_orchestrate)

    response = _post_update(client)

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_webhook_rejects_wrong_secret(client):
    response = client.post(
        "/webhook/telegram",
        json=VOICE_UPDATE,
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong-secret"},
    )
    assert response.status_code == 401


def test_webhook_ignores_non_voice_update(monkeypatch, client):
    called = {"orchestrate": False}

    async def fake_orchestrate(**kwargs):
        called["orchestrate"] = True

    monkeypatch.setattr(telegram_webhook_module, "orchestrate", fake_orchestrate)

    text_update = {
        "update_id": 2,
        "message": {
            "message_id": 11,
            "date": 1700000000,
            "chat": {"id": 555, "type": "private"},
            "from": {"id": 555, "is_bot": False, "first_name": "Jan"},
            "text": "/start",
        },
    }
    response = _post_update(client, text_update)

    assert response.status_code == 200
    assert called["orchestrate"] is False


def _text_update(text: str, chat_type: str = "private") -> dict:
    return {
        "update_id": 2,
        "message": {
            "message_id": 11,
            "date": 1700000000,
            "chat": {"id": 555, "type": chat_type},
            "from": {"id": 555, "is_bot": False, "first_name": "Jan", "username": "jan"},
            "text": text,
        },
    }


@pytest.fixture
def captured(monkeypatch):
    calls: dict = {"activate": [], "send": []}

    async def fake_activate(channel, token, external_user_id, display_name=None):
        calls["activate"].append((token, external_user_id, display_name))
        return "linked"

    async def fake_send(chat_id, text):
        calls["send"].append((chat_id, text))

    monkeypatch.setattr(telegram_webhook_module, "activate_channel_link", fake_activate)
    monkeypatch.setattr(telegram_webhook_module, "send_telegram_message", fake_send)
    return calls


def test_start_with_code_activates_link(client, captured):
    response = _post_update(client, _text_update("/start abcdefghijklmnopQRST_-12"))
    assert response.json() == {"ok": True}
    assert captured["activate"] == [("abcdefghijklmnopQRST_-12", "555", "@jan")]
    assert captured["send"][0][1] == telegram_webhook_module.REPLIES["linked"]


def test_start_in_group_is_refused(client, captured):
    _post_update(client, _text_update("/start abcdefghijklmnopQRST_-12", chat_type="group"))
    assert captured["activate"] == []
    assert captured["send"][0][1] == telegram_webhook_module.REPLIES["invalid"]


def test_plain_text_is_ignored(client, captured):
    _post_update(client, _text_update("ahoj"))
    assert captured == {"activate": [], "send": []}
