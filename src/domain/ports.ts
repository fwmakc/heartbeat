/** Порты домена: контракты, которые реализует инфраструктура. */

import type { Client, DeliveryAttempt, DeliveryResult, Message } from './models.js';

export interface ClientRepository {
  getIdByKeyHash(keyHash: string): Promise<string | null>;
  add(client: Client): Promise<void>;
}

export interface MessageRepository {
  save(message: Message): Promise<void>;
  get(messageId: string): Promise<Message | null>;
  recent(clientId: string, limit: number): Promise<Message[]>;
}

export interface AttemptRepository {
  save(attempt: DeliveryAttempt): Promise<void>;
  statsByChannel(): Promise<Record<string, Record<string, number>>>;
  forMessage(messageId: string): Promise<DeliveryAttempt[]>;
}

/** Единый контракт канала доставки. Любой канал — только за этот интерфейс. */
export interface NotificationChannel {
  readonly channelName: string;
  /** Результат одной попытки доставки: ок / retryable / permanent. */
  send(recipient: string, text: string): Promise<DeliveryResult>;
  close?(): Promise<void>;
}
