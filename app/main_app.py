"""Фабрика приложения: собираем слои, реестр каналов, кеш и лимиты."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.adapters.channels.base import BaseChannel
from app.adapters.channels.stubs import CallAdapter, EmailAdapter, MaxAdapter, SmsAdapter
from app.adapters.channels.telegram import TelegramAdapter
from app.adapters.storage.engine import create_engine, create_session_factory
from app.adapters.storage.repositories import PgApiKeyLookup
from app.api.routes import cabinet_router, router
from app.infrastructure.api_keys import ApiKeyResolver
from app.infrastructure.cache import TTLCache
from app.infrastructure.limits import LimitsProvider
from app.infrastructure.settings import Settings


def build_channels(settings: Settings) -> dict[str, BaseChannel]:
    """Реестр каналов. Новый канал = новый адаптер + строка здесь, бизнес-логика не трогается."""
    return {
        "telegram": TelegramAdapter(settings.telegram_bot_token),
        "max": MaxAdapter(settings.max_api_base_url, settings.max_api_token),
        "sms": SmsAdapter(settings.sms_provider_base_url, settings.sms_provider_api_key),
        "call": CallAdapter(settings.call_provider_base_url, settings.call_provider_api_key),
        "email": EmailAdapter(
            settings.smtp_host,
            settings.smtp_port,
            settings.smtp_user,
            settings.smtp_password,
            settings.smtp_from,
        ),
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    cache = TTLCache(default_ttl=settings.cache_default_ttl_seconds)
    limits = LimitsProvider(settings.config_limits_path, cache)
    engine = create_engine(settings.database_url)
    session_factory: async_sessionmaker = create_session_factory(engine)
    channels = build_channels(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        for channel in channels.values():
            await channel.aclose()
        await engine.dispose()

    app = FastAPI(title="heartbeat", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = session_factory
    app.state.channels = channels
    app.state.limits = limits
    app.state.cache = cache
    app.state.resolve_api_key = ApiKeyResolver(PgApiKeyLookup(session_factory), cache).resolve

    app.include_router(router)
    app.include_router(cabinet_router)
    Instrumentator().instrument(app).expose(app)
    return app
