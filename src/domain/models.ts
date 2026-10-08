/** Доменные сущности шлюза. Без зависимостей от инфраструктуры. */

export enum Channel {
  Telegram = 'telegram',
  Max = 'max',
  Sms = 'sms',
  Call = 'call',
  Email = 'email',
}

export const ALL_CHANNELS: readonly Channel[] = Object.values(Channel);

export enum MessageStatus {
  Pending = 'pending',
  Delivered = 'delivered',
  Failed = 'failed',
}

export enum AttemptStatus {
  Ok = 'ok',
  RetryableError = 'retryable_error',
  PermanentError = 'permanent_error',
}

export interface DeliveryResult {
  status: AttemptStatus;
  latencyMs: number;
  externalId?: string;
  error?: string;
}

export interface DeliveryAttempt {
  id: string;
  messageId: string;
  channel: Channel;
  status: AttemptStatus;
  latencyMs: number;
  error?: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  clientId: string;
  recipient: string;
  text: string;
  /** Порядок = порядок фолбэка. */
  channels: Channel[];
  status: MessageStatus;
  /** Заполняет GetMessageDetail. */
  attempts: DeliveryAttempt[];
  createdAt: Date;
}

export interface Client {
  id: string;
  name: string;
  /** sha256, сам ключ храним только в момент выдачи. */
  apiKeyHash: string;
  createdAt: Date;
}
