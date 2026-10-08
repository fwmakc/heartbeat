/** Базовый класс канала доставки. Любой канал — только за этот интерфейс. */

import type { DeliveryResult } from '../../domain/models.js';
import { AttemptStatus } from '../../domain/models.js';

export class ChannelError extends Error {
  /** retryable=true — стоит попробовать снова (фолбэк тоже идёт дальше). */
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'ChannelError';
    this.retryable = retryable;
  }
}

export abstract class BaseChannel {
  abstract readonly channelName: string;

  /** Замеряет латентность и переводит ChannelError в DeliveryResult. */
  async send(recipient: string, text: string): Promise<DeliveryResult> {
    const started = performance.now();
    try {
      const externalId = await this.deliver(recipient, text);
      return {
        status: AttemptStatus.Ok,
        latencyMs: Math.round(performance.now() - started),
        externalId,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      if (err instanceof ChannelError) {
        const status = err.retryable ? AttemptStatus.RetryableError : AttemptStatus.PermanentError;
        return { status, latencyMs, error: err.message };
      }
      // Неожиданное исключение трактуем как временную аварию канала.
      return {
        status: AttemptStatus.RetryableError,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  protected abstract deliver(recipient: string, text: string): Promise<string>;
}
