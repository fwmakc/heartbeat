/** API: аутентификация ключом, отправка, история, статистика, кабинет, метрики. */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { createApp, type AppDeps } from '../src/app.js';
import type { AppConfig } from '../src/infrastructure/config.js';
import { LimitsProvider } from '../src/infrastructure/limits.js';
import { TTLCache } from '../src/infrastructure/cache.js';
import { Channel, MessageStatus } from '../src/domain/models.js';
import {
  FakeAttemptRepository,
  FakeChannel,
  FakeMessageRepository,
} from './fakes.js';

const API_KEY = 'test-key';
const CLIENT_ID = randomUUID();
const TMP_DIR = mkdtempSync(path.join(tmpdir(), 'hb-api-'));
writeFileSync(path.join(TMP_DIR, 'limits.yaml'), 'default: {messagesPerMinute: 5}\n');

function makeConfig(): AppConfig {
  return {
    appEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://x:x@localhost:1/x',
    telegramBotToken: '',
    telegramMaxRetries: 3,
    telegramBackoffBaseMs: 0,
    maxApiBaseUrl: '',
    maxApiToken: '',
    smsProviderBaseUrl: '',
    smsProviderApiKey: '',
    callProviderBaseUrl: '',
    callProviderApiKey: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpFrom: '',
    configLimitsPath: path.join(TMP_DIR, 'limits.yaml'),
    cacheDefaultTtlSeconds: 60,
  };
}

interface TestContext {
  app: FastifyInstance;
  telegram: FakeChannel;
  attempts: FakeAttemptRepository;
}

/** Свежее приложение на каждый кейс: без общего состояния между тестами. */
async function makeApp(): Promise<TestContext> {
  const telegram = new FakeChannel('telegram');
  const attempts = new FakeAttemptRepository();
  const deps: AppDeps = {
    channels: new Map([[Channel.Telegram, telegram]]),
    clients: {
      getIdByKeyHash: async () => null,
      add: async () => {},
    },
    messages: new FakeMessageRepository(),
    attempts,
    resolveApiKey: async (key) => (key === API_KEY ? CLIENT_ID : null),
    limits: new LimitsProvider(path.join(TMP_DIR, 'limits.yaml'), new TTLCache(60)),
    cache: new TTLCache(60),
  };
  const app = createApp(makeConfig(), deps);
  await app.ready();
  return { app, telegram, attempts };
}

describe('API', () => {
  it('healthz', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('кабинет отдает HTML', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/cabinet' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('heartbeat');
    await app.close();
  });

  it('без ключа — 401', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: { recipient: 'x', text: 'hi' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('чужой ключ — 401', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': 'wrong' },
      payload: { recipient: 'x', text: 'hi' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('отправка доставляется через telegram', async () => {
    const { app, telegram, attempts } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': API_KEY },
      payload: { recipient: '@chat', text: 'привет' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe(MessageStatus.Delivered);
    expect(body.delivered_via).toBe('telegram');
    expect(telegram.calls).toHaveLength(1);
    expect(attempts.items).toHaveLength(1);
    await app.close();
  });

  it('неизвестный канал в body — 400', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': API_KEY },
      payload: { recipient: '@chat', text: 'привет', channels: ['smoke-signals'] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('список последних сообщений', async () => {
    const { app } = await makeApp();
    await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': API_KEY },
      payload: { recipient: '@chat', text: 'второй' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages',
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ recipient: string; channels: string[] }>>();
    expect(body).toHaveLength(1);
    expect(body[0]?.recipient).toBe('@chat');
    expect(body[0]?.channels).toContain('telegram');
    await app.close();
  });

  it('детали чужого/несуществующего сообщения — 404', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/messages/${randomUUID()}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('stats по каналам', async () => {
    const { app } = await makeApp();
    await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'x-api-key': API_KEY },
      payload: { recipient: '@chat', text: 'для статистики' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ telegram: { ok: 1 } });
    await app.close();
  });

  it('метрики prometheus отдаются', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('heartbeat_messages_total');
    await app.close();
  });
});
