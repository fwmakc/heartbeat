"""Telegram-канал: Bot API sendMessage. Рабочий, не заглушка."""

from __future__ import annotations

import httpx

from app.adapters.channels.base import BaseChannel, ChannelError

API_TIMEOUT_SECONDS = 10.0


class TelegramAdapter(BaseChannel):
    channel_name = "telegram"

    def __init__(self, bot_token: str, client: httpx.AsyncClient | None = None) -> None:
        self._bot_token = bot_token
        self._client = client or httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS)

    async def _deliver(self, recipient: str, text: str) -> str:
        if not self._bot_token:
            raise ChannelError("TELEGRAM_BOT_TOKEN не настроен", retryable=False)
        resp = await self._client.post(
            f"https://api.telegram.org/bot{self._bot_token}/sendMessage",
            json={"chat_id": recipient, "text": text},
        )
        if resp.status_code != 200:
            # 429/5xx — временные, остальное (4xx) — плохой chat_id, ретраить смысла нет.
            retryable = resp.status_code == 429 or resp.status_code >= 500
            raise ChannelError(f"telegram: HTTP {resp.status_code}", retryable=retryable)
        data = resp.json()
        if not data.get("ok"):
            raise ChannelError(f"telegram: {data.get('description', 'unknown')}")
        return str(data["result"]["message_id"])

    async def aclose(self) -> None:
        await self._client.aclose()
