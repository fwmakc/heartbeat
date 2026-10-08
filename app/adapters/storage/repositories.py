"""Postgres-репозитории. Списывания в домен — вручную, без ORM-утечек наверх."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage.tables import ClientRow, DeliveryAttemptRow, MessageRow
from app.domain.models import (
    AttemptStatus,
    Channel,
    Client,
    DeliveryAttempt,
    Message,
)


def _to_domain(row: MessageRow) -> Message:
    return Message(
        id=row.id,
        client_id=row.client_id,
        recipient=row.recipient,
        text=row.text,
        channels=[Channel(c) for c in row.channels.split(",")],
        status=row.status,
        created_at=row.created_at.timestamp(),
    )


class PgClientRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_id_by_key_hash(self, key_hash: str) -> uuid.UUID | None:
        row = await self._session.execute(
            select(ClientRow.id).where(ClientRow.api_key_hash == key_hash)
        )
        return row.scalar_one_or_none()

    async def add(self, client: Client) -> None:
        self._session.add(
            ClientRow(
                id=client.id,
                name=client.name,
                api_key_hash=client.api_key_hash,
            )
        )
        await self._session.commit()


class PgApiKeyLookup:
    """Адаптер для ApiKeyResolver: сам открывает сессию на lookup."""

    def __init__(self, session_factory) -> None:
        self._session_factory = session_factory

    async def get_id_by_key_hash(self, key_hash: str) -> uuid.UUID | None:
        async with self._session_factory() as session:
            return await PgClientRepository(session).get_id_by_key_hash(key_hash)


class PgMessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, message: Message) -> None:
        self._session.add(
            MessageRow(
                id=message.id,
                client_id=message.client_id,
                recipient=message.recipient,
                text=message.text,
                channels=",".join(c.value for c in message.channels),
                status=message.status,
            )
        )
        await self._session.commit()

    async def get(self, message_id: uuid.UUID) -> Message | None:
        row = await self._session.get(MessageRow, message_id)
        return _to_domain(row) if row else None

    async def recent(self, client_id: uuid.UUID, limit: int = 20) -> list[Message]:
        rows = await self._session.execute(
            select(MessageRow)
            .where(MessageRow.client_id == client_id)
            .order_by(MessageRow.created_at.desc())
            .limit(limit)
        )
        return [_to_domain(row) for row in rows.scalars()]


class PgAttemptRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, attempt: DeliveryAttempt) -> None:
        self._session.add(
            DeliveryAttemptRow(
                id=attempt.id,
                message_id=attempt.message_id,
                channel=attempt.channel.value,
                status=attempt.status,
                latency_ms=attempt.latency_ms,
                error=attempt.error,
            )
        )
        await self._session.commit()

    async def stats_by_channel(self) -> dict[str, dict[str, int]]:
        rows = await self._session.execute(
            select(
                DeliveryAttemptRow.channel,
                DeliveryAttemptRow.status,
                func.count(),
            ).group_by(DeliveryAttemptRow.channel, DeliveryAttemptRow.status)
        )
        stats: dict[str, dict[str, int]] = {}
        for channel, status, count in rows:
            stats.setdefault(channel, {})[status.value] = count
        return stats

    async def for_message(self, message_id: uuid.UUID) -> list[DeliveryAttempt]:
        rows = await self._session.execute(
            select(DeliveryAttemptRow)
            .where(DeliveryAttemptRow.message_id == message_id)
            .order_by(DeliveryAttemptRow.created_at)
        )
        return [
            DeliveryAttempt(
                id=row.id,
                message_id=row.message_id,
                channel=Channel(row.channel),
                status=AttemptStatus(row.status),
                latency_ms=row.latency_ms,
                error=row.error,
                created_at=row.created_at.timestamp(),
            )
            for row in rows.scalars()
        ]
