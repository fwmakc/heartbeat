"""Доменные сущности шлюза доставки. Без зависимостей от инфраструктуры."""

from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field


class Channel(str, enum.Enum):
    TELEGRAM = "telegram"
    MAX = "max"
    SMS = "sms"
    CALL = "call"
    EMAIL = "email"


class MessageStatus(str, enum.Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


class AttemptStatus(str, enum.Enum):
    OK = "ok"
    RETRYABLE_ERROR = "retryable_error"
    PERMANENT_ERROR = "permanent_error"


@dataclass(slots=True)
class DeliveryResult:
    """Итог одной попытки доставки по каналу."""

    status: AttemptStatus
    latency_ms: int
    external_id: str | None = None
    error: str | None = None


@dataclass(slots=True)
class DeliveryAttempt:
    id: uuid.UUID
    message_id: uuid.UUID
    channel: Channel
    status: AttemptStatus
    latency_ms: int
    error: str | None = None
    created_at: float = field(default_factory=time.time)


@dataclass(slots=True)
class Message:
    """Уведомление клиента: текст + получатель + приоритет каналов."""

    id: uuid.UUID
    client_id: uuid.UUID
    recipient: str
    text: str
    channels: list[Channel]  # порядок = порядок фолбэка
    status: MessageStatus = MessageStatus.PENDING
    created_at: float = field(default_factory=time.time)
