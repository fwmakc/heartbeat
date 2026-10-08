/**
 * Резолвер API-ключей: sha256 ключа -> clientId, с TTL-кешем в памяти.
 *
 * Секреты в БД не храним в открытом виде; сам ключ показываем клиенту один
 * раз при выдаче (src/tools/addClient.ts). SIGHUP (reload лимитов) сбрасывает кеш.
 */

import { createHash } from 'node:crypto';

import type { TTLCache } from './cache.js';

export function hashKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export interface KeyLookup {
  getIdByKeyHash(keyHash: string): Promise<string | null>;
}

export class ApiKeyResolver {
  constructor(
    private readonly lookup: KeyLookup,
    private readonly cache: TTLCache,
  ) {}

  async resolve(apiKey: string | null | undefined): Promise<string | null> {
    if (!apiKey) return null;
    const keyHash = hashKey(apiKey);
    return this.cache.getOrSet(`api_key:${keyHash}`, () => this.lookup.getIdByKeyHash(keyHash));
  }
}
