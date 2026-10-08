/** TTL-кеш и лимиты с перезагрузкой. */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TTLCache } from '../src/infrastructure/cache.js';
import { LimitsProvider } from '../src/infrastructure/limits.js';

describe('TTLCache', () => {
  it('кеширует и инвалидируется', async () => {
    const cache = new TTLCache(60);
    let calls = 0;
    const loader = async (): Promise<{ rate: number }> => {
      calls += 1;
      return { rate: 10 };
    };
    expect(await cache.getOrSet('k', loader)).toEqual({ rate: 10 });
    expect(await cache.getOrSet('k', loader)).toEqual({ rate: 10 });
    expect(calls).toBe(1);
    cache.invalidate();
    expect(await cache.getOrSet('k', loader)).toEqual({ rate: 10 });
    expect(calls).toBe(2);
  });
});

describe('LimitsProvider', () => {
  it('reload подхватывает новый файл', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'limits-'));
    const file = path.join(dir, 'limits.yaml');
    writeFileSync(file, 'default: {messagesPerMinute: 10}\nfallbackChain: [telegram]\n');
    const provider = new LimitsProvider(file, new TTLCache());
    expect(provider.get().default.messagesPerMinute).toBe(10);

    writeFileSync(file, 'default: {messagesPerMinute: 500}\nfallbackChain: [sms]\n');
    provider.reload();
    expect(provider.get().default.messagesPerMinute).toBe(500);
    expect(provider.get().fallbackChain).toEqual(['sms']);
  });

  it('битый YAML — работаем на старом конфиге', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'limits-'));
    const file = path.join(dir, 'limits.yaml');
    writeFileSync(file, 'default: {messagesPerMinute: 42}\n');
    const provider = new LimitsProvider(file, new TTLCache());
    writeFileSync(file, '\t\t: [broken');
    provider.reload();
    expect(provider.get().default.messagesPerMinute).toBe(42);
  });
});
