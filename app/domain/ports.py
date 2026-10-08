"""Порты домена: интерфейсы, которые реализует инфраструктура."""

from __future__ import annotations

import uuid
from typing import Protocol

from app.domain.models import DeliveryAttempt, Message


class MessageRepository(Protocol):
    async def save(self, message: Message) -> None: ...
    async def get(self, message_id: uuid.UUID) -> Message | None: ...


class AttemptRepository(Protocol):
    async def save(self, attempt: DeliveryAttempt) -> None: ...
    async def stats_by_channel(self) -> dict[str, dict[str, int]]: ...


class NotificationChannel(Protocol):
    """Единый контракт канала доставки. Любой канал — только за этот интерфейс."""

    channel_name: str

    async def send(self, recipient: str, text: str) -> str: ...
    """Возвращает external_id доставленного сообщения или бросает ChannelError."""
