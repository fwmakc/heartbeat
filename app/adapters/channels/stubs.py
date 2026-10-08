"""Каркас каналов с провайдером-заглушкой.

Контракт и HTTP-клиент готовы, боевой провайдер подключается реализацией
_deliver() без изменения бизнес-логики. Пока каналы отдают permanent error —
фолбэк-цепочка честно их пропускает.
"""

from __future__ import annotations

import httpx

from app.adapters.channels.base import BaseChannel, ChannelError


class HttpProviderChannel(BaseChannel):
    """Базовый каркас для каналов поверх внешнего HTTP API провайдера."""

    channel_name = "base-http"
    provider_base_url: str = ""

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._client = httpx.AsyncClient(timeout=10.0)

    async def _deliver(self, recipient: str, text: str) -> str:
        if not self._base_url or not self._api_key:
            raise ChannelError(
                f"провайдер канала {self.channel_name} не настроен", retryable=False
            )
        resp = await self._client.post(
            f"{self._base_url}/messages",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={"recipient": recipient, "text": text},
        )
        if resp.status_code != 200:
            retryable = resp.status_code == 429 or resp.status_code >= 500
            raise ChannelError(
                f"{self.channel_name}: HTTP {resp.status_code}", retryable=retryable
            )
        return str(resp.json()["id"])

    async def aclose(self) -> None:
        await self._client.aclose()


class MaxAdapter(HttpProviderChannel):
    """API Макс сыроват (задержки до минуты, обрывы очереди) — потому за
    интерфейсом и с retryable-ошибками: фолбэк уведёт трафик дальше."""

    channel_name = "max"


class SmsAdapter(HttpProviderChannel):
    channel_name = "sms"


class CallAdapter(HttpProviderChannel):
    """Звонок-будилка: API провайдера, тонкая настройка — следующим заходом."""

    channel_name = "call"


class EmailAdapter(BaseChannel):
    """SMTP-канал. aiosmtplib не тянем в MVP: отправка через smtplib в треде."""

    channel_name = "email"

    def __init__(self, host: str, port: int, user: str, password: str, sender: str) -> None:
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._sender = sender

    async def _deliver(self, recipient: str, text: str) -> str:
        if not self._host:
            raise ChannelError("SMTP не настроен", retryable=False)
        import asyncio
        import smtplib
        from email.message import EmailMessage

        def _send() -> None:
            msg = EmailMessage()
            msg["From"] = self._sender
            msg["To"] = recipient
            msg.set_content(text)
            with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
                smtp.starttls()
                if self._user:
                    smtp.login(self._user, self._password)
                smtp.send_message(msg)

        await asyncio.to_thread(_send)
        return f"email:{recipient}"
