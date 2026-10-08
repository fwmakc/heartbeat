"""Простой TTL-кеш в памяти: справочные данные не тянем из БД на каждый запрос."""

from __future__ import annotations

import time
from typing import Any, Callable


class TTLCache:
    def __init__(self, default_ttl: float = 60.0) -> None:
        self._default_ttl = default_ttl
        self._store: dict[str, tuple[float, Any]] = {}

    def get_or_set(self, key: str, loader: Callable[[], Any], ttl: float | None = None) -> Any:
        entry = self._store.get(key)
        now = time.monotonic()
        if entry is not None and entry[0] > now:
            return entry[1]
        value = loader()
        self._store[key] = (now + (ttl if ttl is not None else self._default_ttl), value)
        return value

    def invalidate(self, key: str | None = None) -> None:
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)
