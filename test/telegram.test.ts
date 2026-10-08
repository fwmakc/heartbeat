/** TelegramAdapter: ретраи, 429 Retry-After, сетевые сбои, перманентные 4xx. */

import { describe, expect, it } from 'vitest';

import { TelegramAdapter, type FetchLike } from '../src/adapters/channels/telegram.js';
import { AttemptStatus } from '../src/domain/models.js';

interface Call {
  readonly url: string;
  readonly body: unknown;
}

function makeAdapter(
  responses: Array<(() => Response) | Error>,
  opts: { maxRetries?: number } = {},
): { adapter: TelegramAdapter; calls: Call[] } {
  const calls: Call[] = [];
  let step = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const current = responses[Math.min(step, responses.length - 1)];
    step += 1;
    if (current instanceof Error) throw current;
    return current();
  };
  const sleeps: number[] = [];
  const adapter = new TelegramAdapter('token', {
    maxRetries: opts.maxRetries ?? 3,
    backoffBaseMs: 0,
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { adapter, calls };
}

const ok = (messageId: number): (() => Response) => () =>
  Response.json({ ok: true, result: { message_id: messageId } });

describe('TelegramAdapter', () => {
  it('успех возвращает message id', async () => {
    const { adapter, calls } = makeAdapter([ok(42)]);
    const result = await adapter.send('@chat', 'привет');
    expect(result.status).toBe(AttemptStatus.Ok);
    expect(result.externalId).toBe('42');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ chat_id: '@chat', text: 'привет' });
  });

  it('нет токена — постоянная ошибка', async () => {
    const adapter = new TelegramAdapter('', {
      fetchImpl: async () => ok(1)(),
      sleepImpl: async () => {},
    });
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.PermanentError);
    expect(result.error).toContain('не настроен');
  });

  it('4xx — постоянная ошибка без ретраев', async () => {
    const { adapter, calls } = makeAdapter([() => Response.json({ ok: false }, { status: 400 })], {
      maxRetries: 5,
    });
    const result = await adapter.send('bad_chat', 'текст');
    expect(result.status).toBe(AttemptStatus.PermanentError);
    expect(calls).toHaveLength(1);
  });

  it('429 с Retry-After: ретрай и успех', async () => {
    const { adapter, calls } = makeAdapter([
      () => Response.json({ ok: false, parameters: { retry_after: 0 } }, { status: 429 }),
      ok(7),
    ]);
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.Ok);
    expect(result.externalId).toBe('7');
    expect(calls).toHaveLength(2);
  });

  it('429 исчерпан — retryable, число запросов = 1 + maxRetries', async () => {
    const { adapter, calls } = makeAdapter(
      [() => Response.json({ ok: false, parameters: { retry_after: 0 } }, { status: 429 })],
      { maxRetries: 2 },
    );
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.RetryableError);
    expect(calls).toHaveLength(3);
  });

  it('5xx исчерпан — retryable', async () => {
    const { adapter, calls } = makeAdapter([() => Response.json({ ok: false }, { status: 502 })], {
      maxRetries: 2,
    });
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.RetryableError);
    expect(calls).toHaveLength(3);
  });

  it('сетевая ошибка — retryable, попыток = 1 + ретраи, ответов нет', async () => {
    const { adapter, calls } = makeAdapter([new Error('connection refused')], { maxRetries: 1 });
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.RetryableError);
    expect(calls).toHaveLength(2); // исходная + 1 ретрай, ни один не дошёл до ответа
  });

  it('HTTP 200 с ok:false — ошибка с описанием', async () => {
    const { adapter } = makeAdapter([() => Response.json({ ok: false, description: 'weird' })]);
    const result = await adapter.send('@chat', 'текст');
    expect(result.status).toBe(AttemptStatus.RetryableError);
    expect(result.error).toContain('weird');
  });
});
