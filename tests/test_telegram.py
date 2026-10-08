"""TelegramAdapter: ретраи, 429 Retry-After, сетевые сбои, перманентные 4xx.

Всё на httpx.MockTransport, backoff_base=0 — без пауз и реальной сети.
"""

from __future__ import annotations

import httpx

from app.adapters.channels.telegram import TelegramAdapter
from app.domain.models import AttemptStatus


def make_adapter(handler, max_retries: int = 3) -> tuple[TelegramAdapter, list[int]]:
    codes: list[int] = []

    def counting_handler(request: httpx.Request) -> httpx.Response:
        response: httpx.Response = handler(request)
        codes.append(response.status_code)
        return response

    client = httpx.AsyncClient(transport=httpx.MockTransport(counting_handler))
    adapter = TelegramAdapter("token", client=client, max_retries=max_retries, backoff_base=0)
    return adapter, codes


async def test_success_returns_message_id():
    def handler(request):
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 42}})

    adapter, codes = make_adapter(handler)
    result = await adapter.send("@chat", "привет")
    assert result.status is AttemptStatus.OK
    assert result.external_id == "42"
    assert codes == [200]


async def test_missing_token_is_permanent():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    adapter = TelegramAdapter("", client=client)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.PERMANENT_ERROR
    assert "не настроен" in (result.error or "")


async def test_4xx_is_permanent_no_retries():
    def handler(request):
        return httpx.Response(400, json={"ok": False, "description": "chat not found"})

    adapter, codes = make_adapter(handler, max_retries=5)
    result = await adapter.send("bad_chat", "текст")
    assert result.status is AttemptStatus.PERMANENT_ERROR
    assert codes == [400]  # ни одного ретрая


async def test_429_retries_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                429, json={"ok": False, "parameters": {"retry_after": 0}}
            )
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 7}})

    adapter, codes = make_adapter(handler)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.OK
    assert result.external_id == "7"
    assert codes == [429, 200]


async def test_429_exhausts_retries():
    def handler(request):
        return httpx.Response(429, json={"ok": False, "parameters": {"retry_after": 0}})

    adapter, codes = make_adapter(handler, max_retries=2)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.RETRYABLE_ERROR
    assert len(codes) == 3  # 1 исходная + 2 ретрая


async def test_5xx_retries_then_permanent_failure():
    def handler(request):
        return httpx.Response(502, json={"ok": False})

    adapter, codes = make_adapter(handler, max_retries=2)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.RETRYABLE_ERROR
    assert len(codes) == 3


async def test_network_error_is_retryable():
    def handler(request):
        raise httpx.ConnectError("connection refused")

    adapter, codes = make_adapter(handler, max_retries=1)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.RETRYABLE_ERROR
    assert len(codes) == 0  # до ответа не дошло


async def test_ok_flag_false_treated_as_error():
    def handler(request):
        return httpx.Response(200, json={"ok": False, "description": "weird"})

    adapter, _ = make_adapter(handler)
    result = await adapter.send("@chat", "текст")
    assert result.status is AttemptStatus.RETRYABLE_ERROR
    assert "weird" in (result.error or "")
