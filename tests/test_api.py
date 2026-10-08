"""API-роуты: аутентификация ключом, отправка, статистика, healthz."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.api.routes import get_send_message, get_stats, register_api_key
from app.application.use_cases import GetDeliveryStats, SendReport
from app.domain.models import Channel, MessageStatus
from app.main_app import create_app
from app.infrastructure.settings import Settings
from tests.fakes import FakeAttemptRepository, FakeChannel


def make_client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "limits.yaml").write_text("default: {messages_per_minute: 5}", encoding="utf-8")
    settings = Settings(
        database_url="postgresql+asyncpg://x:x@localhost:1/x",
        config_limits_path=tmp_path / "limits.yaml",
        telegram_bot_token="",
    )
    app = create_app(settings)
    app.state.channels = {"telegram": FakeChannel("telegram")}
    return TestClient(app, raise_server_exceptions=False)


def test_healthz(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.get("/v1/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_send_requires_api_key(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.post("/v1/messages", json={"recipient": "x", "text": "hi"})
    assert resp.status_code == 401


def test_send_message_delivered(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)

    async def fake_send(*args, **kwargs):
        return SendReport(
            message_id=uuid.uuid4(),
            status=MessageStatus.DELIVERED,
            delivered_via=Channel.TELEGRAM,
            attempts=[],
        )

    client.app.dependency_overrides[get_send_message] = lambda: type(
        "S", (), {"execute": staticmethod(fake_send)}
    )()
    key = "test-key"
    register_api_key(key)
    resp = client.post(
        "/v1/messages",
        json={"recipient": "@chat", "text": "привет"},
        headers={"X-API-Key": key},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "delivered"
    assert body["delivered_via"] == "telegram"


def test_stats_endpoint(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    repo = FakeAttemptRepository()

    class StatsFake(GetDeliveryStats):
        async def execute(self):
            return {"telegram": {"ok": 3, "retryable_error": 1}}

    client.app.dependency_overrides[get_stats] = lambda: StatsFake(repo)
    key = "test-key"
    register_api_key(key)
    resp = client.get("/v1/stats", headers={"X-API-Key": key})
    assert resp.status_code == 200
    assert resp.json() == {"telegram": {"ok": 3, "retryable_error": 1}}
