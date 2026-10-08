"""Резолвер API-ключей: кеш в памяти, один lookup на TTL."""

from __future__ import annotations

import uuid

from app.infrastructure.api_keys import ApiKeyResolver, hash_key
from app.infrastructure.cache import TTLCache
from tests.fakes import FakeClientRepository


async def test_resolver_caches_lookup():
    repo = FakeClientRepository()
    client_id = uuid.uuid4()
    repo.by_hash[hash_key("good-key")] = client_id

    resolver = ApiKeyResolver(repo, TTLCache(default_ttl=60))
    assert await resolver.resolve("good-key") == client_id
    assert await resolver.resolve("good-key") == client_id
    assert await resolver.resolve("bad-key") is None
    assert await resolver.resolve(None) is None
    assert len(repo.by_hash) == 1  # не расплодили запросов мимо кеша: bad-key не кешируем дважды


async def test_resolver_invalidates_with_cache():
    repo = FakeClientRepository()
    client_id = uuid.uuid4()
    cache = TTLCache(default_ttl=60)
    resolver = ApiKeyResolver(repo, cache)

    assert await resolver.resolve("k1") is None
    repo.by_hash[hash_key("k1")] = client_id
    assert await resolver.resolve("k1") is None  # ещё в кеше None
    cache.invalidate()  # то же делает SIGHUP-reload лимитов
    assert await resolver.resolve("k1") == client_id
