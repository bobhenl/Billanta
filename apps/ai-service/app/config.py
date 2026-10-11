"""Runtime configuration for the AI voice-to-invoice microservice.

All values are read from environment variables (or a local `.env` file via
python-dotenv/pydantic-settings). See `.env.example` for the full list and
blueprint §6/§8 for why each secret exists and how narrowly it's scoped.

Notably `BACKEND_SERVICE_JWT` must be a *scoped* service token (draft-creation
and tenant/channel-link resolution only) — never a superuser/admin credential.
This service must never be able to issue invoices or read other tenants' data
(blueprint §8, §9).
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed application settings, populated from the environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- OpenAI (Whisper transcription + GPT-4o structured extraction) ---
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    # --- Telegram Bot API ---
    telegram_bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    # Secret token Telegram echoes back in the `X-Telegram-Bot-Api-Secret-Token`
    # header on every webhook call (set via setWebhook's secret_token param).
    telegram_webhook_secret: str = Field(default="", alias="TELEGRAM_WEBHOOK_SECRET")

    # --- Meta WhatsApp Cloud API ---
    whatsapp_access_token: str = Field(default="", alias="WHATSAPP_ACCESS_TOKEN")
    # Used to verify the X-Hub-Signature-256 HMAC on incoming webhook payloads.
    whatsapp_app_secret: str = Field(default="", alias="WHATSAPP_APP_SECRET")
    # Used only for the GET verification handshake (hub.verify_token echo).
    whatsapp_webhook_verify_token: str = Field(
        default="", alias="WHATSAPP_WEBHOOK_VERIFY_TOKEN"
    )

    # --- Backend (NestJS) integration ---
    backend_api_url: str = Field(
        default="http://backend:3000", alias="BACKEND_API_URL"
    )
    # Scoped service JWT — see module docstring. NOT a superuser token.
    backend_service_jwt: str = Field(default="", alias="BACKEND_SERVICE_JWT")

    # --- Misc ---
    environment: str = Field(default="development", alias="ENVIRONMENT")


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (read once per process)."""
    return Settings()
