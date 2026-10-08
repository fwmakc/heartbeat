"""HTTP API: /v1/messages, /v1/stats, /cabinet, /healthz.

Аутентификация — API-ключом (заголовок X-API-Key): sha256 ключа -> client_id
из БД, резолв кешируется в памяти (TTL). Ключи выдаёт app/tools/add_client.py.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage.repositories import (
    PgAttemptRepository,
    PgMessageRepository,
)
from app.api.cabinet import CABINET_HTML
from app.application.use_cases import (
    GetMessageDetail,
    GetDeliveryStats,
    ListMessages,
    SendMessage,
)
from app.domain.models import Channel, Message, MessageStatus

router = APIRouter(prefix="/v1")
cabinet_router = APIRouter()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия на запрос, закрывается вместе с зависимостью."""
    async with request.app.state.session_factory() as session:
        yield session


async def get_client_id(
    request: Request, x_api_key: Annotated[str | None, Header()] = None
) -> uuid.UUID:
    client_id = await request.app.state.resolve_api_key(x_api_key)
    if client_id is None:
        raise HTTPException(status_code=401, detail="invalid api key")
    return client_id


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


def get_message_list(
    session: Annotated[AsyncSession, Depends(get_session)]
) -> ListMessages:
    return ListMessages(PgMessageRepository(session))


def get_message_detail(
    session: Annotated[AsyncSession, Depends(get_session)]
) -> GetMessageDetail:
    return GetMessageDetail(PgMessageRepository(session), PgAttemptRepository(session))


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


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class MessageListItem(BaseModel):
    message_id: uuid.UUID
    recipient: str
    status: MessageStatus
    channels: list[str]
    created_at: str


class MessageDetailOut(MessageListItem):
    text: str
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


@router.get("/messages", response_model=list[MessageListItem])
async def list_messages(
    client_id: Annotated[uuid.UUID, Depends(get_client_id)],
    list_use_case: Annotated[ListMessages, Depends(get_message_list)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[MessageListItem]:
    messages = await list_use_case.execute(client_id, limit)
    return [
        MessageListItem(
            message_id=m.id,
            recipient=m.recipient,
            status=m.status,
            channels=[c.value for c in m.channels],
            created_at=_iso(m.created_at),
        )
        for m in messages
    ]


@router.get("/messages/{message_id}", response_model=MessageDetailOut)
async def message_detail(
    message_id: uuid.UUID,
    client_id: Annotated[uuid.UUID, Depends(get_client_id)],
    detail: Annotated[GetMessageDetail, Depends(get_message_detail)],
) -> MessageDetailOut:
    m: Message | None = await detail.execute(client_id, message_id)
    if m is None:
        raise HTTPException(status_code=404, detail="message not found")
    return MessageDetailOut(
        message_id=m.id,
        recipient=m.recipient,
        status=m.status,
        channels=[c.value for c in m.channels],
        created_at=_iso(m.created_at),
        text=m.text,
        attempts=[
            AttemptOut(
                channel=a.channel.value,
                status=a.status.value,
                latency_ms=a.latency_ms,
                error=a.error,
            )
            for a in m.attempts
        ],
    )


@router.get("/stats")
async def stats(
    get: Annotated[GetDeliveryStats, Depends(get_stats)],
    _client_id: Annotated[uuid.UUID, Depends(get_client_id)],
) -> dict[str, dict[str, int]]:
    return await get.execute()


@cabinet_router.get("/cabinet", response_class=HTMLResponse, include_in_schema=False)
async def cabinet() -> HTMLResponse:
    return HTMLResponse(CABINET_HTML)


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
