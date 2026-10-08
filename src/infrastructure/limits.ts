/**
 * Конфиг лимитов/тарифов: читается из YAML, перечитывается по SIGHUP.
 *
 * Distroless без шелла — SIGHUP доходит только при exec-форме ENTRYPOINT,
 * обработчик ставится в main.ts.
 */

import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import type { TTLCache } from './cache.js';

export interface RateLimit {
  messagesPerMinute: number;
  messagesPerDay: number;
}

export interface LimitsConfig {
  default: RateLimit;
  tariffs: Record<string, { priceRub?: number } & Partial<RateLimit>>;
  fallbackChain: string[];
}

const DEFAULT_FALLBACK = ['telegram', 'max', 'sms', 'call', 'email'];

export class LimitsProvider {
  private config: LimitsConfig;

  constructor(
    private readonly path: string,
    private readonly cache: TTLCache,
    private readonly logger: (msg: string) => void = () => {},
  ) {
    this.config = this.load();
  }

  get(): LimitsConfig {
    return this.config;
  }

  reload(): void {
    try {
      this.config = this.load();
    } catch (err) {
      this.logger(`Не удалось перечитать ${this.path}, работаем на старом конфиге: ${String(err)}`);
      return;
    }
    this.cache.invalidate();
    this.logger(`Конфиг лимитов перечитан: ${this.path}`);
  }

  installSignalHandler(): void {
    process.on('SIGHUP', () => this.reload());
  }

  private load(): LimitsConfig {
    const raw = (parse(readFileSync(this.path, 'utf8')) ?? {}) as Record<string, unknown>;
    const def = (raw['default'] ?? {}) as Record<string, unknown>;
    const fallback = raw['fallbackChain'] ?? raw['fallback_chain'];
    return {
      default: {
        messagesPerMinute: num(def['messagesPerMinute'], 60),
        messagesPerDay: num(def['messagesPerDay'], 10_000),
      },
      tariffs: (raw['tariffs'] ?? {}) as LimitsConfig['tariffs'],
      fallbackChain: Array.isArray(fallback) ? (fallback as string[]) : DEFAULT_FALLBACK,
    };
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
