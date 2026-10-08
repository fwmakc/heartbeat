/** Прикладные сценарии: отправка с фолбэком, статистика, история. */

import type {
  AttemptRepository,
  MessageRepository,
  NotificationChannel,
} from '../domain/ports.js';
import {
  AttemptStatus,
  type Channel,
  type DeliveryAttempt,
  type Message,
  MessageStatus,
} from '../domain/models.js';
import { newId } from '../adapters/storage/repositories.js';

export interface SendReport {
  messageId: string;
  status: MessageStatus;
  deliveredVia: Channel | null;
}

export class SendMessage {
  /** Проходит каналы в заданном порядке, пока доставка не подтверждена. */
  constructor(
    private readonly channels: ReadonlyMap<string, NotificationChannel>,
    private readonly messages: MessageRepository,
    private readonly attempts: AttemptRepository,
  ) {}

  async execute(
    clientId: string,
    recipient: string,
    text: string,
    channels: readonly Channel[],
  ): Promise<SendReport> {
    const message: Message = {
      id: newId(),
      clientId,
      recipient,
      text,
      channels: [...channels],
      status: MessageStatus.Pending,
      attempts: [],
      createdAt: new Date(),
    };
    await this.messages.save(message);

    let deliveredVia: Channel | null = null;
    for (const channel of channels) {
      const impl = this.channels.get(channel.valueOf());
      if (!impl) continue; // канал не зарегистрирован — пропускаем
      const result = await impl.send(recipient, text);
      const attempt: DeliveryAttempt = {
        id: newId(),
        messageId: message.id,
        channel,
        status: result.status,
        latencyMs: result.latencyMs,
        error: result.error,
        createdAt: new Date(),
      };
      await this.attempts.save(attempt);
      if (result.status === AttemptStatus.Ok) {
        deliveredVia = channel;
        break;
      }
    }

    const status = deliveredVia ? MessageStatus.Delivered : MessageStatus.Failed;
    message.status = status;
    await this.messages.save(message);
    return { messageId: message.id, status, deliveredVia };
  }
}

export class GetDeliveryStats {
  constructor(private readonly attempts: AttemptRepository) {}

  execute(): Promise<Record<string, Record<string, number>>> {
    return this.attempts.statsByChannel();
  }
}

export class ListMessages {
  constructor(private readonly messages: MessageRepository) {}

  execute(clientId: string, limit: number): Promise<Message[]> {
    return this.messages.recent(clientId, limit);
  }
}

export class GetMessageDetail {
  constructor(
    private readonly messages: MessageRepository,
    private readonly attempts: AttemptRepository,
  ) {}

  /** Чужое сообщение не подсвечиваем — null. */
  async execute(clientId: string, messageId: string): Promise<Message | null> {
    const message = await this.messages.get(messageId);
    if (!message || message.clientId !== clientId) return null;
    message.attempts = await this.attempts.forMessage(messageId);
    return message;
  }
}
