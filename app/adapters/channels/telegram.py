"""Telegram-канал: Bot API sendMessage.

Боевой режим: 429 (с Retry-After) и 5xx ретраятся с экспоненциальным
backoff, сетевые сбои — retryable, 4xx (не тот chat_id, бот заблокирован) —
постоянная ошибка, фолбэк уводит сообщение в следующий канал сразу.
"""

from __future__ import annotations

import asyncio

import httpx

from app.adapters.channels.base import BaseChannel, ChannelError

API_TIMEOUT_SECONDS = 10.0
RETRYABLE_429 = 429


class TelegramAdapter(BaseChannel):
    channel_name = "telegram"

    def __init__(
        self,
        bot_token: str,
        client: httpx.AsyncClient | None = None,
        max_retries: int = 3,
        backoff_base: float = 0.5,
    ) -> None:
        self._bot_token = bot_token
        self._max_retries = max_retries
        self._backoff_base = backoff_base
        self._client = client or httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS)

    async def _deliver(self, recipient: str, text: str) -> str:
        if not self._bot_token:
            raise ChannelError("TELEGRAM_BOT_TOKEN не настроен", retryable=False)
        for attempt in range(self._max_retries + 1):
            result = await self._attempt(recipient, text, attempt)
            if result is not None:
                return result
        raise ChannelError("telegram: исчерпаны ретраи")  # pragma: no cover

    async def _attempt(self, recipient: str, text: str, attempt: int) -> str | None:
        """Возвращает external_id или бросает ChannelError (окончательную)."""
        try:
            resp = await self._client.post(
                f"https://api.telegram.org/bot{self._bot_token}/sendMessage",
                json={"chat_id": recipient, "text": text},
            )
        except httpx.TransportError as exc:
            if attempt >= self._max_retries:
                raise ChannelError(f"telegram: сеть, исчерпаны ретраи: {exc}") from exc
            await self._sleep(self._backoff_base, attempt)
            return None

        if resp.status_code == 200:
            data = resp.json()
            if not data.get("ok"):
                raise ChannelError(f"telegram: {data.get('description', 'unknown')}")
            return str(data["result"]["message_id"])

        if resp.status_code == RETRYABLE_429:
            if attempt >= self._max_retries:
                raise ChannelError("telegram: HTTP 429, исчерпаны ретраи")
            retry_after = self._retry_after(resp)
            await self._sleep(retry_after if retry_after else self._backoff_base, attempt)
            return None

        if resp.status_code >= 500:
            if attempt >= self._max_retries:
                raise ChannelError(f"telegram: HTTP {resp.status_code}, исчерпаны ретраи")
            await self._sleep(self._backoff_base, attempt)
            return None

        # 4xx: неверный chat_id, бот заблокирован и т.п. — ретраить смысла нет.
        raise ChannelError(f"telegram: HTTP {resp.status_code}", retryable=False)

    async def _sleep(self, base: float, attempt: int) -> None:
        await asyncio.sleep(base * (2**attempt))

    @staticmethod
    def _retry_after(resp: httpx.Response) -> float | None:
        try:
            return float(resp.json().get("parameters", {}).get("retry_after"))
        except (ValueError, AttributeError, TypeError):
            return None

    async def aclose(self) -> None:
        await self._client.aclose()
