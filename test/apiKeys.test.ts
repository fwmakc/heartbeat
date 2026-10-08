/** Резолвер API-ключей: один lookup на TTL, инвалидация вместе с кешем. */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiKeyResolver, hashKey } from '../src/infrastructure/apiKeys.js';
import { TTLCache } from '../src/infrastructure/cache.js';
import { FakeClientRepository } from './fakes.js';

describe('ApiKeyResolver', () => {
  it('кеширует lookup', async () => {
    const repo = new FakeClientRepository();
    const clientId = randomUUID();
    repo.byHash.set(hashKey('good-key'), clientId);

    const resolver = new ApiKeyResolver(repo, new TTLCache(60));
    expect(await resolver.resolve('good-key')).toBe(clientId);
    expect(await resolver.resolve('good-key')).toBe(clientId);
    expect(await resolver.resolve('bad-key')).toBeNull();
    expect(await resolver.resolve(null)).toBeNull();
    expect(await resolver.resolve(undefined)).toBeNull();
  });

  it('SIGHUP-reload (cache.invalidate) открывает новые ключи', async () => {
    const repo = new FakeClientRepository();
    const clientId = randomUUID();
    const cache = new TTLCache(60);
    const resolver = new ApiKeyResolver(repo, cache);

    expect(await resolver.resolve('k1')).toBeNull();
    repo.byHash.set(hashKey('k1'), clientId);
    expect(await resolver.resolve('k1')).toBeNull(); // ещё в кеше
    cache.invalidate();
    expect(await resolver.resolve('k1')).toBe(clientId);
  });
});
