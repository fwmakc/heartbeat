"""Настройки приложения. Секреты — только из окружения (.env)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_env: str = "staging"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    database_url: str = "postgresql+asyncpg://heartbeat:changeit@localhost:5432/heartbeat"

    telegram_bot_token: str = ""
    max_api_base_url: str = ""
    max_api_token: str = ""
    sms_provider_base_url: str = ""
    sms_provider_api_key: str = ""
    call_provider_base_url: str = ""
    call_provider_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    config_limits_path: Path = BASE_DIR / "config" / "limits.yaml"
    cache_default_ttl_seconds: float = 60.0


def get_settings() -> Settings:
    return Settings()
