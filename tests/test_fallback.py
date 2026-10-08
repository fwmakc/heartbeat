"""Фолбэк-оркестратор: идём по цепочке до первой успешной доставки."""

from __future__ import annotations

import uuid

from app.adapters.channels.base import ChannelError
from app.application.use_cases import SendMessage
from app.domain.models import AttemptStatus, Channel, MessageStatus
from tests.fakes import FakeAttemptRepository, FakeChannel, FakeMessageRepository


async def test_first_channel_success_stops_chain():
    telegram = FakeChannel("telegram")
    use_case = SendMessage(
        channels={"telegram": telegram},
        messages=FakeMessageRepository(),
        attempts=FakeAttemptRepository(),
    )
    report = await use_case.execute(
        uuid.uuid4(), "@chat", "привет", [Channel.TELEGRAM, Channel.SMS]
    )
    assert report.status is MessageStatus.DELIVERED
    assert report.delivered_via is Channel.TELEGRAM


async def test_fallback_to_second_channel():
    telegram = FakeChannel("telegram", fail_with=ChannelError("queue lost", retryable=True))
    max_ = FakeChannel("max")
    use_case = SendMessage(
        channels={"telegram": telegram, "max": max_},
        messages=FakeMessageRepository(),
        attempts=FakeAttemptRepository(),
    )
    report = await use_case.execute(
        uuid.uuid4(), "+79990001122", "заказ", [Channel.TELEGRAM, Channel.MAX]
    )
    assert report.delivered_via is Channel.MAX
    assert len(telegram.calls) == 1


async def test_all_channels_fail_marks_message_failed():
    telegram = FakeChannel("telegram", fail_with=ChannelError("down"))
    max_ = FakeChannel("max", fail_with=ChannelError("bad recipient", retryable=False))
    attempts_repo = FakeAttemptRepository()
    use_case = SendMessage(
        channels={"telegram": telegram, "max": max_},
        messages=FakeMessageRepository(),
        attempts=attempts_repo,
    )
    report = await use_case.execute(
        uuid.uuid4(), "x", "текст", [Channel.TELEGRAM, Channel.MAX]
    )
    assert report.status is MessageStatus.FAILED
    assert report.delivered_via is None
    assert {a.channel.value for a in attempts_repo.items} == {"telegram", "max"}
    statuses = {a.status for a in attempts_repo.items}
    assert statuses == {AttemptStatus.RETRYABLE_ERROR, AttemptStatus.PERMANENT_ERROR}


async def test_unregistered_channel_skipped():
    use_case = SendMessage(
        channels={},  # ничего не зарегистрировано
        messages=FakeMessageRepository(),
        attempts=FakeAttemptRepository(),
    )
    report = await use_case.execute(uuid.uuid4(), "x", "текст", [Channel.TELEGRAM])
    assert report.status is MessageStatus.FAILED
