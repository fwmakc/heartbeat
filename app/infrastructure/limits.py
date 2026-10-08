"""Конфиг лимитов/тарифов: читается из YAML, перечитывается по SIGHUP.

Distroless без шелла — SIGHUP доходит только при exec-форме ENTRYPOINT,
проверка сигнала живёт в main.py.
"""

from __future__ import annotations

import logging
import signal
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.infrastructure.cache import TTLCache

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RateLimit:
    messages_per_minute: int = 60
    messages_per_day: int = 10000


@dataclass(slots=True)
class LimitsConfig:
    default: RateLimit = field(default_factory=RateLimit)
    tariffs: dict[str, dict] = field(default_factory=dict)
    fallback_chain: list[str] = field(
        default_factory=lambda: ["telegram", "max", "sms", "call", "email"]
    )


class LimitsProvider:
    """Держит лимиты в памяти, по SIGHUP перечитывает YAML и сбрасывает кеш."""

    def __init__(self, path: Path, cache: TTLCache) -> None:
        self._path = path
        self._cache = cache
        self._config = self._load()
        self._install_signal()

    def get(self) -> LimitsConfig:
        return self._config

    def reload(self) -> None:
        try:
            self._config = self._load()
        except Exception:
            logger.exception("Не удалось перечитать %s, работаем на старом конфиге", self._path)
            return
        self._cache.invalidate()
        logger.info("Конфиг лимитов перечитан: %s", self._path)

    def _install_signal(self) -> None:
        try:
            signal.signal(signal.SIGHUP, lambda *_: self.reload())
        except (AttributeError, ValueError):
            # Windows / не-главный поток: reload дергается вручную или админкой.
            logger.warning("SIGHUP недоступен на этой платформе, авто-reload выключен")

    def _load(self) -> LimitsConfig:
        raw = yaml.safe_load(self._path.read_text(encoding="utf-8")) or {}
        default = RateLimit(**(raw.get("default") or {}))
        return LimitsConfig(
            default=default,
            tariffs=raw.get("tariffs") or {},
            fallback_chain=raw.get("fallback_chain") or ["telegram", "max", "sms", "call", "email"],
        )
