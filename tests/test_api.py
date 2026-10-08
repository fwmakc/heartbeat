"""API-роуты: аутентификация ключом, отправка, история, статистика, кабинет."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.api.routes import (
    get_message_detail,
    get_message_list,
    get_send_message,
    get_stats,
)
from app.application.use_cases import (
    GetMessageDetail,
    GetDeliveryStats,
    ListMessages,
    SendReport,
)
from app.domain.models import (
    AttemptStatus,
    Channel,
    DeliveryAttempt,
    Message,
    MessageStatus,
)
from app.infrastructure.settings import Settings
from app.main_app import create_app
from tests.fakes import FakeAttemptRepository, FakeChannel

API_KEY = "test-key"
CLIENT_ID = uuid.uuid4()


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

    async def resolve_api_key(key: str | None):
        return {API_KEY: CLIENT_ID}.get(key) if key else None

    app.state.resolve_api_key = resolve_api_key
    return TestClient(app, raise_server_exceptions=False)


def auth_headers() -> dict[str, str]:
    return {"X-API-Key": API_KEY}


def test_healthz(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.get("/v1/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_cabinet_page(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.get("/cabinet")
    assert resp.status_code == 200
    assert "heartbeat" in resp.text


def test_send_requires_api_key(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.post("/v1/messages", json={"recipient": "x", "text": "hi"})
    assert resp.status_code == 401


def test_send_rejects_bad_key(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    resp = client.post(
        "/v1/messages",
        json={"recipient": "x", "text": "hi"},
        headers={"X-API-Key": "wrong"},
    )
    assert resp.status_code == 401


def test_send_message_delivered(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    message_id = uuid.uuid4()

    async def fake_execute(self, client_id, recipient, text, channels):
        assert client_id == CLIENT_ID
        return SendReport(
            message_id=message_id,
            status=MessageStatus.DELIVERED,
            delivered_via=Channel.TELEGRAM,
            attempts=[],
        )

    client.app.dependency_overrides[get_send_message] = lambda: type(
        "S", (), {"execute": fake_execute}
    )()
    resp = client.post(
        "/v1/messages",
        json={"recipient": "@chat", "text": "привет"},
        headers=auth_headers(),
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "delivered"
    assert body["delivered_via"] == "telegram"


def test_list_messages(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    message = Message(
        id=uuid.uuid4(),
        client_id=CLIENT_ID,
        recipient="@chat",
        text="текст",
        channels=[Channel.TELEGRAM],
        status=MessageStatus.DELIVERED,
        created_at=0.0,
    )

    class ListFake(ListMessages):
        async def execute(self, client_id, limit=20):
            assert client_id == CLIENT_ID
            return [message]

    client.app.dependency_overrides[get_message_list] = lambda: ListFake(None)
    resp = client.get("/v1/messages", headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["recipient"] == "@chat"
    assert body[0]["channels"] == ["telegram"]


def test_message_detail_hides_foreign_message(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)

    class DetailFake(GetMessageDetail):
        async def execute(self, client_id, message_id):
            return None  # чужое или несуществующее

    client.app.dependency_overrides[get_message_detail] = lambda: DetailFake(None, None)
    resp = client.get(f"/v1/messages/{uuid.uuid4()}", headers=auth_headers())
    assert resp.status_code == 404


def test_message_detail_with_attempts(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)
    message_id = uuid.uuid4()

    class DetailFake(GetMessageDetail):
        async def execute(self, client_id, mid):
            return Message(
                id=mid,
                client_id=client_id,
                recipient="+7999",
                text="заказ",
                channels=[Channel.TELEGRAM, Channel.SMS],
                status=MessageStatus.DELIVERED,
                attempts=[
                    DeliveryAttempt(
                        id=uuid.uuid4(),
                        message_id=mid,
                        channel=Channel.TELEGRAM,
                        status=AttemptStatus.OK,
                        latency_ms=120,
                    )
                ],
                created_at=0.0,
            )

    client.app.dependency_overrides[get_message_detail] = lambda: DetailFake(None, None)
    resp = client.get(f"/v1/messages/{message_id}", headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "delivered"
    assert body["attempts"][0]["latency_ms"] == 120


def test_stats_endpoint(tmp_path, monkeypatch):
    client = make_client(monkeypatch, tmp_path)

    class StatsFake(GetDeliveryStats):
        async def execute(self):
            return {"telegram": {"ok": 3, "retryable_error": 1}}

    client.app.dependency_overrides[get_stats] = lambda: StatsFake(FakeAttemptRepository())
    resp = client.get("/v1/stats", headers=auth_headers())
    assert resp.status_code == 200
    assert resp.json() == {"telegram": {"ok": 3, "retryable_error": 1}}
