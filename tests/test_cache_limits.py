"""TTL-кеш и лимиты с перезагрузкой по SIGHUP."""

from __future__ import annotations

from pathlib import Path

import yaml

from app.infrastructure.cache import TTLCache
from app.infrastructure.limits import LimitsProvider


def test_ttl_cache_hit_and_invalidate():
    cache = TTLCache(default_ttl=60)
    calls = []

    def loader():
        calls.append(1)
        return {"rate": 10}

    assert cache.get_or_set("k", loader) == {"rate": 10}
    assert cache.get_or_set("k", loader) == {"rate": 10}
    assert len(calls) == 1
    cache.invalidate()
    assert cache.get_or_set("k", loader) == {"rate": 10}
    assert len(calls) == 2


def test_limits_reload_picks_up_new_file(tmp_path: Path):
    limits_file = tmp_path / "limits.yaml"
    limits_file.write_text(
        yaml.safe_dump({"default": {"messages_per_minute": 10}, "fallback_chain": ["telegram"]}),
        encoding="utf-8",
    )
    provider = LimitsProvider(limits_file, TTLCache())
    assert provider.get().default.messages_per_minute == 10

    limits_file.write_text(
        yaml.safe_dump({"default": {"messages_per_minute": 500}, "fallback_chain": ["sms"]}),
        encoding="utf-8",
    )
    provider.reload()
    assert provider.get().default.messages_per_minute == 500
    assert provider.get().fallback_chain == ["sms"]


def test_limits_reload_keeps_old_config_on_broken_yaml(tmp_path: Path):
    limits_file = tmp_path / "limits.yaml"
    limits_file.write_text("default: {messages_per_minute: 42}", encoding="utf-8")
    provider = LimitsProvider(limits_file, TTLCache())
    limits_file.write_text("\t\t: [broken", encoding="utf-8")
    provider.reload()
    assert provider.get().default.messages_per_minute == 42
