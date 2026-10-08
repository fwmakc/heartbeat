/**
 * Каркас каналов с провайдером-заглушкой.
 *
 * Контракт и HTTP-клиент готовы, боевой провайдер подключается реализацией
 * deliver() без изменения бизнес-логики. Пока каналы отдают permanent error —
 * фолбэк-цепочка честно их пропускает.
 */

import nodemailer, { type Transporter } from 'nodemailer';

import type { FetchLike } from './telegram.js';
import { ChannelError, BaseChannel } from './base.js';

export abstract class HttpProviderChannel extends BaseChannel {
  abstract override readonly channelName: string;

  protected constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    super();
  }

  protected async deliver(recipient: string, text: string): Promise<string> {
    if (!this.baseUrl || !this.apiKey) {
      throw new ChannelError(`провайдер канала ${this.channelName} не настроен`, false);
    }
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ recipient, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ChannelError(`${this.channelName}: сеть: ${String(err)}`);
    }
    if (!resp.ok) {
      throw new ChannelError(`${this.channelName}: HTTP ${resp.status}`, resp.status === 429 || resp.status >= 500);
    }
    const data = (await resp.json()) as { id?: string };
    if (!data.id) {
      throw new ChannelError(`${this.channelName}: в ответе провайдера нет id`);
    }
    return data.id;
  }
}

/** API Макс сыроват (задержки до минуты, обрывы очереди) — потому за
 * интерфейсом и с retryable-ошибками: фолбэк уведёт трафик дальше. */
export class MaxAdapter extends HttpProviderChannel {
  readonly channelName = 'max';

  constructor(baseUrl: string, apiKey: string, fetchImpl?: FetchLike) {
    super(baseUrl, apiKey, fetchImpl);
  }
}

export class SmsAdapter extends HttpProviderChannel {
  readonly channelName = 'sms';

  constructor(baseUrl: string, apiKey: string, fetchImpl?: FetchLike) {
    super(baseUrl, apiKey, fetchImpl);
  }
}

/** Звонок-будилка: API провайдера, тонкая настройка — следующим заходом. */
export class CallAdapter extends HttpProviderChannel {
  readonly channelName = 'call';

  constructor(baseUrl: string, apiKey: string, fetchImpl?: FetchLike) {
    super(baseUrl, apiKey, fetchImpl);
  }
}

export class EmailAdapter extends BaseChannel {
  readonly channelName = 'email';

  private readonly transporter: Transporter | null;

  constructor(
    host: string,
    port: number,
    user: string,
    password: string,
    private readonly sender: string,
  ) {
    super();
    this.transporter = host
      ? nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass: password } : undefined })
      : null;
  }

  protected async deliver(recipient: string, text: string): Promise<string> {
    if (!this.transporter) {
      throw new ChannelError('SMTP не настроен', false);
    }
    const info = await this.transporter.sendMail({
      from: this.sender,
      to: recipient,
      text,
    });
    return info.messageId;
  }

  async close(): Promise<void> {
    await this.transporter?.close();
  }
}
