"""Shared pytest fixtures for the ai-service test suite.

None of these tests make real network calls or spawn a real `ffmpeg`
process — every external boundary (httpx, the `openai` SDK,
`asyncio.create_subprocess_exec`) is faked/mocked. See each test module's
docstring for exactly what is and isn't covered.
"""

from __future__ import annotations

import pytest

from app.config import Settings


@pytest.fixture
def settings() -> Settings:
    """A fully-populated Settings instance with dummy (non-real) secrets.

    Constructed directly (bypassing environment/`.env` file loading) so
    tests are hermetic and don't depend on the local dev environment.
    """
    return Settings(
        environment="test",
        openai_api_key="test-openai-key",
        telegram_bot_token="test-telegram-token",
        telegram_webhook_secret="test-telegram-webhook-secret",
        whatsapp_access_token="test-whatsapp-token",
        whatsapp_app_secret="test-whatsapp-app-secret",
        whatsapp_webhook_verify_token="test-whatsapp-verify-token",
        backend_api_url="http://backend.test",
        backend_service_jwt="test-backend-jwt",
    )
