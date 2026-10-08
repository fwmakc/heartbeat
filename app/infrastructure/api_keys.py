"""Резолвер API-ключей: sha256 ключа -> client_id, с TTL-кешем в памяти.

Секреты в БД не храним в открытом виде; сам ключ показываем клиенту один раз
при выдаче (app/tools/add_client.py). SIGHUP (reload лимитов) сбрасывает кеш.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Protocol

from app.infrastructure.cache import TTLCache


class KeyLookup(Protocol):
    async def get_id_by_key_hash(self, key_hash: str) -> uuid.UUID | None: ...


def hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


class ApiKeyResolver:
    def __init__(self, lookup: KeyLookup, cache: TTLCache) -> None:
        self._lookup = lookup
        self._cache = cache

    async def resolve(self, api_key: str | None) -> uuid.UUID | None:
        if not api_key:
            return None
        key_hash = hash_key(api_key)
        return await self._cache.aget_or_set(f"api_key:{key_hash}", lambda: self._lookup.get_id_by_key_hash(key_hash))
