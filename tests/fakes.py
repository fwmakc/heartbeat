"""Фейковые каналы и in-memory репозитории для тестов."""

from __future__ import annotations

import uuid

from app.adapters.channels.base import BaseChannel, ChannelError
from app.domain.models import (
    AttemptStatus,
    Client,
    DeliveryAttempt,
    Message,
)


class FakeChannel(BaseChannel):
    def __init__(self, name: str, fail_with: ChannelError | None = None) -> None:
        self.channel_name = name
        self._fail_with = fail_with
        self.calls: list[tuple[str, str]] = []

    async def _deliver(self, recipient: str, text: str) -> str:
        self.calls.append((recipient, text))
        if self._fail_with:
            raise self._fail_with
        return f"{self.channel_name}:msg-1"


class FakeMessageRepository:
    def __init__(self) -> None:
        self.items: dict[uuid.UUID, Message] = {}

    async def save(self, message: Message) -> None:
        self.items[message.id] = message

    async def get(self, message_id: uuid.UUID) -> Message | None:
        return self.items.get(message_id)


class FakeAttemptRepository:
    def __init__(self) -> None:
        self.items: list[DeliveryAttempt] = []

    async def save(self, attempt: DeliveryAttempt) -> None:
        self.items.append(attempt)

    async def stats_by_channel(self) -> dict[str, dict[str, int]]:
        stats: dict[str, dict[str, int]] = {}
        for a in self.items:
            stats.setdefault(a.channel.value, {}).setdefault(a.status.value, 0)
            stats[a.channel.value][a.status.value] += 1
        return stats

    async def for_message(self, message_id: uuid.UUID) -> list[DeliveryAttempt]:
        return [a for a in self.items if a.message_id == message_id]


class FakeClientRepository:
    def __init__(self) -> None:
        self.by_hash: dict[str, uuid.UUID] = {}

    async def get_id_by_key_hash(self, key_hash: str) -> uuid.UUID | None:
        return self.by_hash.get(key_hash)

    async def add(self, client: Client) -> None:
        self.by_hash[client.api_key_hash] = client.id


OK = AttemptStatus.OK
