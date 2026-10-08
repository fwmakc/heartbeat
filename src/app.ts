/** Фабрика приложения: Fastify + маршруты + метрики + OpenAPI. */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { Counter, collectDefaultMetrics, Registry } from 'prom-client';

import { CABINET_HTML } from './api/cabinet.js';
import {
  GetMessageDetail,
  GetDeliveryStats,
  ListMessages,
  SendMessage,
} from './application/useCases.js';
import {
  ALL_CHANNELS,
  type Channel,
  type Message,
} from './domain/models.js';
import type {
  AttemptRepository,
  ClientRepository,
  MessageRepository,
  NotificationChannel,
} from './domain/ports.js';
import type { LimitsProvider } from './infrastructure/limits.js';
import type { TTLCache } from './infrastructure/cache.js';
import type { AppConfig } from './infrastructure/config.js';

export interface AppDeps {
  channels: ReadonlyMap<string, NotificationChannel>;
  clients: ClientRepository;
  messages: MessageRepository;
  attempts: AttemptRepository;
  resolveApiKey: (apiKey: string | null | undefined) => Promise<string | null>;
  limits: LimitsProvider;
  cache: TTLCache;
}

const CHANNEL_VALUES = ALL_CHANNELS.map((c) => c.valueOf());

const sendMessageBodySchema = {
  type: 'object',
  required: ['recipient', 'text'],
  additionalProperties: false,
  properties: {
    recipient: { type: 'string', minLength: 1, maxLength: 512 },
    text: { type: 'string', minLength: 1, maxLength: 4096 },
    channels: { type: 'array', minItems: 1, items: { enum: CHANNEL_VALUES } },
  },
} as const;

function apiKeyOf(request: FastifyRequest): string | null {
  const raw = request.headers['x-api-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

function iso(date: Date): string {
  return date.toISOString();
}

function channelsOf(message: Message): string[] {
  return message.channels.map((c) => c.valueOf());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(config: AppConfig, deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: config.appEnv === 'prod' ? 'info' : 'debug' },
    disableRequestLogging: true,
  });
  const registry = new Registry();
  // Сбор системных метрик держит интервал-таймер — в тестах не запускаем.
  if (config.appEnv !== 'test') collectDefaultMetrics({ register: registry });
  const messagesTotal = new Counter({
    name: 'heartbeat_messages_total',
    help: 'Итог отправки по сообщению',
    registers: [registry],
    labelNames: ['status', 'delivered_via'],
  });

  const send = new SendMessage(deps.channels, deps.messages, deps.attempts);
  const list = new ListMessages(deps.messages);
  const detail = new GetMessageDetail(deps.messages, deps.attempts);
  const stats = new GetDeliveryStats(deps.attempts);

  app.get('/v1/healthz', async () => ({ status: 'ok' }));

  app.get(
    '/v1/messages',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
        },
      },
    },
    async (request, reply) => {
      const clientId = await deps.resolveApiKey(apiKeyOf(request));
      if (!clientId) return reply.code(401).send({ detail: 'invalid api key' });
      const { limit } = request.query as { limit?: number };
      const messages = await list.execute(clientId, limit ?? 20);
      return messages.map((m) => ({
        message_id: m.id,
        recipient: m.recipient,
        status: m.status.valueOf(),
        channels: channelsOf(m),
        created_at: iso(m.createdAt),
      }));
    },
  );

  app.get('/v1/messages/:id', async (request, reply) => {
    const clientId = await deps.resolveApiKey(apiKeyOf(request));
    if (!clientId) return reply.code(401).send({ detail: 'invalid api key' });
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(404).send({ detail: 'message not found' });
    const message = await detail.execute(clientId, id);
    if (!message) return reply.code(404).send({ detail: 'message not found' });
    return {
      message_id: message.id,
      recipient: message.recipient,
      status: message.status.valueOf(),
      channels: channelsOf(message),
      created_at: iso(message.createdAt),
      text: message.text,
      attempts: message.attempts.map((a) => ({
        channel: a.channel.valueOf(),
        status: a.status.valueOf(),
        latency_ms: a.latencyMs,
        error: a.error ?? null,
      })),
    };
  });

  app.post(
    '/v1/messages',
    { schema: { body: sendMessageBodySchema } },
    async (request, reply) => {
      const clientId = await deps.resolveApiKey(apiKeyOf(request));
      if (!clientId) return reply.code(401).send({ detail: 'invalid api key' });
      const body = request.body as { recipient: string; text: string; channels?: string[] };
      const channels = (body.channels ?? CHANNEL_VALUES) as Channel[];
      const report = await send.execute(clientId, body.recipient, body.text, channels);
      messagesTotal.inc({
        status: report.status.valueOf(),
        delivered_via: report.deliveredVia?.valueOf() ?? 'none',
      });
      return reply.code(202).send({
        message_id: report.messageId,
        status: report.status.valueOf(),
        delivered_via: report.deliveredVia?.valueOf() ?? null,
      });
    },
  );

  app.get('/v1/stats', async (request, reply) => {
    const clientId = await deps.resolveApiKey(apiKeyOf(request));
    if (!clientId) return reply.code(401).send({ detail: 'invalid api key' });
    return stats.execute();
  });

  app.get('/metrics', async (_request, reply) => {
    return reply
      .code(200)
      .header('content-type', registry.contentType)
      .send(await registry.metrics());
  });

  app.get('/cabinet', async (_request, reply) => {
    return reply.code(200).header('content-type', 'text/html; charset=utf-8').send(CABINET_HTML);
  });

  void app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'heartbeat',
        description: 'Шлюз гарантированной доставки уведомлений',
        version: config.appEnv === 'prod' ? 'stable' : '0.2.0',
      },
      servers: [{ url: '/' }],
    },
  });
  void app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  return app;
}
