"""HTTP API: /v1/messages, /v1/stats, /healthz.

Аутентификация — API-ключом клиента (заголовок X-API-Key); пока ключи в
статическом реестре, кабинет с ключами в БД следующим заходом.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage.repositories import PgAttemptRepository, PgMessageRepository
from app.application.use_cases import GetDeliveryStats, SendMessage
from app.domain.models import Channel, MessageStatus

router = APIRouter(prefix="/v1")

# MVP-заглушка кабинета: ключ -> client_id. Переедет в БД + TTL-кеш.
_API_KEYS: dict[str, uuid.UUID] = {}


def register_api_key(key: str) -> uuid.UUID:
    client_id = uuid.uuid4()
    _API_KEYS[key] = client_id
    return client_id


def get_client_id(x_api_key: Annotated[str | None, Header()] = None) -> uuid.UUID:
    if not x_api_key or x_api_key not in _API_KEYS:
        raise HTTPException(status_code=401, detail="invalid api key")
    return _API_KEYS[x_api_key]


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия на запрос, закрывается вместе с зависимостью."""
    async with request.app.state.session_factory() as session:
        yield session


def get_send_message(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> SendMessage:
    return SendMessage(
        channels=request.app.state.channels,
        messages=PgMessageRepository(session),
        attempts=PgAttemptRepository(session),
    )


def get_stats(session: Annotated[AsyncSession, Depends(get_session)]) -> GetDeliveryStats:
    return GetDeliveryStats(PgAttemptRepository(session))


class MessageIn(BaseModel):
    recipient: str = Field(min_length=1, max_length=512)
    text: str = Field(min_length=1, max_length=4096)
    channels: list[Channel] | None = None  # None -> дефолтная цепочка фолбэка


class AttemptOut(BaseModel):
    channel: str
    status: str
    latency_ms: int
    error: str | None = None


class MessageOut(BaseModel):
    message_id: uuid.UUID
    status: MessageStatus
    delivered_via: str | None
    attempts: list[AttemptOut]


@router.post("/messages", response_model=MessageOut, status_code=202)
async def send_message(
    body: MessageIn,
    client_id: Annotated[uuid.UUID, Depends(get_client_id)],
    send: Annotated[SendMessage, Depends(get_send_message)],
) -> MessageOut:
    channels = body.channels or list(Channel)  # порядок enum = дефолтная цепочка
    report = await send.execute(client_id, body.recipient, body.text, channels)
    return MessageOut(
        message_id=report.message_id,
        status=report.status,
        delivered_via=report.delivered_via.value if report.delivered_via else None,
        attempts=[
            AttemptOut(
                channel=a.channel.value,
                status=a.status.value,
                latency_ms=a.latency_ms,
                error=a.error,
            )
            for a in report.attempts
        ],
    )


@router.get("/stats")
async def stats(
    get: Annotated[GetDeliveryStats, Depends(get_stats)],
    _client_id: Annotated[uuid.UUID, Depends(get_client_id)],
) -> dict[str, dict[str, int]]:
    return await get.execute()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
