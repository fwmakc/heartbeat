/** Настройки приложения. Секреты — только из окружения (.env). */

import 'dotenv/config';

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && process.env[name] !== undefined && process.env[name] !== ''
    ? parsed
    : fallback;
}

export interface AppConfig {
  appEnv: string;
  host: string;
  port: number;
  databaseUrl: string;

  telegramBotToken: string;
  telegramMaxRetries: number;
  telegramBackoffBaseMs: number;
  maxApiBaseUrl: string;
  maxApiToken: string;
  smsProviderBaseUrl: string;
  smsProviderApiKey: string;
  callProviderBaseUrl: string;
  callProviderApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;

  configLimitsPath: string;
  cacheDefaultTtlSeconds: number;
}

export function loadConfig(): AppConfig {
  return {
    appEnv: env('APP_ENV', 'staging'),
    host: env('APP_HOST', '0.0.0.0'),
    port: envNumber('APP_PORT', 8000),
    databaseUrl: env('DATABASE_URL', 'postgresql://heartbeat:changeit@localhost:5432/heartbeat'),

    telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
    telegramMaxRetries: envNumber('TELEGRAM_MAX_RETRIES', 3),
    telegramBackoffBaseMs: envNumber('TELEGRAM_BACKOFF_BASE_MS', 500),
    maxApiBaseUrl: env('MAX_API_BASE_URL'),
    maxApiToken: env('MAX_API_TOKEN'),
    smsProviderBaseUrl: env('SMS_PROVIDER_BASE_URL'),
    smsProviderApiKey: env('SMS_PROVIDER_API_KEY'),
    callProviderBaseUrl: env('CALL_PROVIDER_BASE_URL'),
    callProviderApiKey: env('CALL_PROVIDER_API_KEY'),
    smtpHost: env('SMTP_HOST'),
    smtpPort: envNumber('SMTP_PORT', 587),
    smtpUser: env('SMTP_USER'),
    smtpPassword: env('SMTP_PASSWORD'),
    smtpFrom: env('SMTP_FROM'),

    configLimitsPath: env('CONFIG_LIMITS_PATH', 'config/limits.yaml'),
    cacheDefaultTtlSeconds: envNumber('CACHE_DEFAULT_TTL_SECONDS', 60),
  };
}
