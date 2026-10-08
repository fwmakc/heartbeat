/** Фейки для тестов: каналы и in-memory репозитории. */

import { ChannelError } from '../src/adapters/channels/base.js';
import type {
  AttemptRepository,
  BaseChannel,
  ClientRepository,
  MessageRepository,
} from '../src/domain/ports.js';
import {
  AttemptStatus,
  type Client,
  type DeliveryAttempt,
  type DeliveryResult,
  type Message,
} from '../src/domain/models.js';

export class FakeChannel implements BaseChannel {
  readonly channelName: string;
  readonly calls: Array<{ recipient: string; text: string }> = [];

  constructor(
    name: string,
    private readonly failWith?: ChannelError,
  ) {
    this.channelName = name;
  }

  async send(recipient: string, text: string): Promise<DeliveryResult> {
    this.calls.push({ recipient, text });
    if (this.failWith) {
      return {
        status: this.failWith.retryable ? AttemptStatus.RetryableError : AttemptStatus.PermanentError,
        latencyMs: 5,
        error: this.failWith.message,
      };
    }
    return { status: AttemptStatus.Ok, latencyMs: 5, externalId: `${this.channelName}:msg-1` };
  }
}

export class FakeMessageRepository implements MessageRepository {
  readonly items = new Map<string, Message>();

  async save(message: Message): Promise<void> {
    this.items.set(message.id, message);
  }

  async get(messageId: string): Promise<Message | null> {
    return this.items.get(messageId) ?? null;
  }

  async recent(clientId: string, limit: number): Promise<Message[]> {
    return [...this.items.values()]
      .filter((m) => m.clientId === clientId)
      .slice(0, limit);
  }
}

export class FakeAttemptRepository implements AttemptRepository {
  readonly items: DeliveryAttempt[] = [];

  async save(attempt: DeliveryAttempt): Promise<void> {
    this.items.push(attempt);
  }

  async statsByChannel(): Promise<Record<string, Record<string, number>>> {
    const stats: Record<string, Record<string, number>> = {};
    for (const attempt of this.items) {
      const byStatus = (stats[attempt.channel] ??= {});
      byStatus[attempt.status] = (byStatus[attempt.status] ?? 0) + 1;
    }
    return stats;
  }

  async forMessage(messageId: string): Promise<DeliveryAttempt[]> {
    return this.items.filter((a) => a.messageId === messageId);
  }
}

export class FakeClientRepository implements ClientRepository {
  readonly byHash = new Map<string, string>();

  async getIdByKeyHash(keyHash: string): Promise<string | null> {
    return this.byHash.get(keyHash) ?? null;
  }

  async add(client: Client): Promise<void> {
    this.byHash.set(client.apiKeyHash, client.id);
  }
}

export { ChannelError, AttemptStatus };
