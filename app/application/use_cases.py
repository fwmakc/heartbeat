"""Прикладные сценарии: отправка с фолбэком и статистика доставки."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from app.domain.models import (
    AttemptStatus,
    Channel,
    DeliveryAttempt,
    Message,
    MessageStatus,
)
from app.domain.ports import AttemptRepository, MessageRepository, NotificationChannel

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SendReport:
    message_id: uuid.UUID
    status: MessageStatus
    delivered_via: Channel | None
    attempts: list[DeliveryAttempt]


class SendMessage:
    """Проходит каналы в заданном порядке, пока доставка не подтвердена."""

    def __init__(
        self,
        channels: dict[str, NotificationChannel],
        messages: MessageRepository,
        attempts: AttemptRepository,
    ) -> None:
        self._channels = channels
        self._messages = messages
        self._attempts = attempts

    async def execute(
        self, client_id: uuid.UUID, recipient: str, text: str, channels: list[Channel]
    ) -> SendReport:
        message = Message(
            id=uuid.uuid4(), client_id=client_id, recipient=recipient, text=text, channels=channels
        )
        await self._messages.save(message)

        delivered_via: Channel | None = None
        for channel in channels:
            impl = self._channels.get(channel.value)
            if impl is None:
                logger.warning("Канал %s не зарегистрирован, пропускаем", channel.value)
                continue
            result = await impl.send(recipient, text)
            attempt = DeliveryAttempt(
                id=uuid.uuid4(),
                message_id=message.id,
                channel=channel,
                status=result.status,
                latency_ms=result.latency_ms,
                error=result.error,
            )
            await self._attempts.save(attempt)
            if result.status is AttemptStatus.OK:
                delivered_via = channel
                break

        message.status = MessageStatus.DELIVERED if delivered_via else MessageStatus.FAILED
        await self._messages.save(message)
        return SendReport(
            message_id=message.id, status=message.status, delivered_via=delivered_via, attempts=[]
        )


class GetDeliveryStats:
    def __init__(self, attempts: AttemptRepository) -> None:
        self._attempts = attempts

    async def execute(self) -> dict[str, dict[str, int]]:
        return await self._attempts.stats_by_channel()
