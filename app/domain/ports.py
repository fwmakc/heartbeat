"""Порты домена: интерфейсы, которые реализует инфраструктура."""

from __future__ import annotations

import uuid
from typing import Protocol

from app.domain.models import Client, DeliveryAttempt, Message


class ClientRepository(Protocol):
    async def get_id_by_key_hash(self, key_hash: str) -> uuid.UUID | None: ...
    async def add(self, client: Client) -> None: ...


class MessageRepository(Protocol):
    async def save(self, message: Message) -> None: ...
    async def get(self, message_id: uuid.UUID) -> Message | None: ...
    async def recent(self, client_id: uuid.UUID, limit: int = 20) -> list[Message]: ...


class AttemptRepository(Protocol):
    async def save(self, attempt: DeliveryAttempt) -> None: ...
    async def stats_by_channel(self) -> dict[str, dict[str, int]]: ...
    async def for_message(self, message_id: uuid.UUID) -> list[DeliveryAttempt]: ...


class NotificationChannel(Protocol):
    """Единый контракт канала доставки. Любой канал — только за этот интерфейс."""

    channel_name: str

    async def send(self, recipient: str, text: str) -> str: ...
    """Возвращает external_id доставленного сообщения или бросает ChannelError."""
