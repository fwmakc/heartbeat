/**
 * Telegram-канал: Bot API sendMessage.
 *
 * Боевой режим: 429 (с Retry-After) и 5xx ретраятся с экспоненциальным
 * backoff, сетевые сбои — retryable, 4xx (не тот chat_id, бот заблокирован) —
 * постоянная ошибка, фолбэк уводит сообщение в следующий канал сразу.
 */

import { BaseChannel, ChannelError } from './base.js';

const API_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface TelegramOptions {
  maxRetries?: number;
  backoffBaseMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

export class TelegramAdapter extends BaseChannel {
  readonly channelName = 'telegram';

  private readonly botToken: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;

  constructor(botToken: string, options: TelegramOptions = {}) {
    super();
    this.botToken = botToken;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  protected async deliver(recipient: string, text: string): Promise<string> {
    if (!this.botToken) {
      throw new ChannelError('TELEGRAM_BOT_TOKEN не настроен', false);
    }
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const result = await this.attempt(recipient, text, attempt);
      if (result !== null) return result;
    }
    throw new ChannelError('telegram: исчерпаны ретраи');
  }

  /** Возвращает externalId или null (нужен ретрай), окончательная ошибка — бросает. */
  private async attempt(recipient: string, text: string, attempt: number): Promise<string | null> {
    let resp: Response;
    try {
      resp = await this.fetchImpl(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: recipient, text }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      if (attempt >= this.maxRetries) {
        throw new ChannelError(`telegram: сеть, исчерпаны ретраи: ${String(err)}`);
      }
      await this.sleep(this.backoffBaseMs, attempt);
      return null;
    }

    if (resp.ok) {
      const data = (await resp.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      if (!data.ok) {
        throw new ChannelError(`telegram: ${data.description ?? 'unknown'}`);
      }
      return String(data.result?.message_id);
    }

    if (resp.status === 429) {
      if (attempt >= this.maxRetries) {
        throw new ChannelError('telegram: HTTP 429, исчерпаны ретраи');
      }
      const retryAfter = await this.retryAfterSeconds(resp);
      await this.sleep(retryAfter !== null ? retryAfter * 1000 : this.backoffBaseMs, attempt);
      return null;
    }

    if (resp.status >= 500) {
      if (attempt >= this.maxRetries) {
        throw new ChannelError(`telegram: HTTP ${resp.status}, исчерпаны ретраи`);
      }
      await this.sleep(this.backoffBaseMs, attempt);
      return null;
    }

    // 4xx: неверный chat_id, бот заблокирован и т.п. — ретраить смысла нет.
    throw new ChannelError(`telegram: HTTP ${resp.status}`, false);
  }

  private async retryAfterSeconds(resp: Response): Promise<number | null> {
    try {
      const data = (await resp.json()) as { parameters?: { retry_after?: number } };
      const value = data.parameters?.retry_after;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private sleep(baseMs: number, attempt: number): Promise<void> {
    return this.sleepImpl(baseMs * 2 ** attempt);
  }
}
