"""Базовый класс канала доставки. Любой канал — только за этот интерфейс."""

from __future__ import annotations

import logging
import time

from app.domain.models import AttemptStatus, DeliveryResult

logger = logging.getLogger(__name__)


class ChannelError(Exception):
    """Ошибка доставки по каналу. retryable=True — стоит попробовать снова позже."""

    def __init__(self, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class BaseChannel:
    """Замеряет латентность и переводит исключения в DeliveryResult.

    Наследники реализуют только _deliver() -> external_id или ChannelError.
    """

    channel_name: str = "base"

    async def send(self, recipient: str, text: str) -> DeliveryResult:
        started = time.monotonic()
        try:
            external_id = await self._deliver(recipient, text)
        except ChannelError as exc:
            latency = int((time.monotonic() - started) * 1000)
            status = (
                AttemptStatus.RETRYABLE_ERROR if exc.retryable else AttemptStatus.PERMANENT_ERROR
            )
            logger.warning("Канал %s: %s (%.0f мс)", self.channel_name, exc, latency)
            return DeliveryResult(status=status, latency_ms=latency, error=str(exc))
        latency = int((time.monotonic() - started) * 1000)
        return DeliveryResult(
            status=AttemptStatus.OK, latency_ms=latency, external_id=external_id
        )

    async def _deliver(self, recipient: str, text: str) -> str:
        raise NotImplementedError
