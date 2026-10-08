"""Postgres-репозитории. Списывания в домен — вручную, без ORM-утечек наверх."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage.tables import DeliveryAttemptRow, MessageRow
from app.domain.models import (
    Channel,
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
