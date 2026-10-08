/**
 * Точка входа: одна, других нет.
 *
 * Distroless не имеет шелла — запуск только exec-формой:
 *   ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
 * SIGHUP перечитывает config/limits.yaml без пересборки.
 */

import { createApp, type AppDeps } from './app.js';
import { PgApiKeyLookup, PgAttemptRepository, PgClientRepository, PgMessageRepository } from './adapters/storage/repositories.js';
import { createPool, migrate } from './adapters/storage/db.js';
import {
  CallAdapter,
  EmailAdapter,
  MaxAdapter,
  SmsAdapter,
} from './adapters/channels/stubs.js';
import { TelegramAdapter } from './adapters/channels/telegram.js';
import type { NotificationChannel } from './domain/ports.js';
import { TTLCache } from './infrastructure/cache.js';
import { loadConfig } from './infrastructure/config.js';
import { ApiKeyResolver } from './infrastructure/apiKeys.js';
import { LimitsProvider } from './infrastructure/limits.js';

const MIGRATIONS_DIR = 'migrations';

async function main(): Promise<void> {
  const config = loadConfig();
  const cache = new TTLCache(config.cacheDefaultTtlSeconds);
  const limits = new LimitsProvider(config.configLimitsPath, cache, (msg) => console.log(msg));
  limits.installSignalHandler();

  const pool = createPool(config.databaseUrl);
  const applied = await migrate(pool, MIGRATIONS_DIR);
  if (applied.length > 0) console.log(`Применены миграции: ${applied.join(', ')}`);

  const channels = new Map<string, NotificationChannel>(Object.entries(buildChannels(config)));
  const apiKeyResolver = new ApiKeyResolver(new PgApiKeyLookup(pool), cache);
  const deps: AppDeps = {
    channels,
    clients: new PgClientRepository(pool),
    messages: new PgMessageRepository(pool),
    attempts: new PgAttemptRepository(pool),
    resolveApiKey: (key) => apiKeyResolver.resolve(key),
    limits,
    cache,
  };

  const app = createApp(config, deps);
  await app.listen({ host: config.host, port: config.port });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Получен ${signal}, останавливаемся`);
    await app.close();
    for (const channel of channels.values()) await channel.close?.();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

function buildChannels(config: ReturnType<typeof loadConfig>): Record<string, NotificationChannel> {
  // Реестр каналов. Новый канал = новый адаптер + строка здесь, бизнес-логика не трогается.
  return {
    telegram: new TelegramAdapter(config.telegramBotToken, {
      maxRetries: config.telegramMaxRetries,
      backoffBaseMs: config.telegramBackoffBaseMs,
    }),
    max: new MaxAdapter(config.maxApiBaseUrl, config.maxApiToken),
    sms: new SmsAdapter(config.smsProviderBaseUrl, config.smsProviderApiKey),
    call: new CallAdapter(config.callProviderBaseUrl, config.callProviderApiKey),
    email: new EmailAdapter(
      config.smtpHost,
      config.smtpPort,
      config.smtpUser,
      config.smtpPassword,
      config.smtpFrom,
    ),
  };
}

void main();
