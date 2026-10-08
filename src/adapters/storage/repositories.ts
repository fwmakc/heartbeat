/** Postgres-репозитории. Строки в домен маппим вручную, без ORM-утечек наверх. */

import { randomUUID } from 'node:crypto';

import type { Queryable } from './db.js';
import type { ClientRepository, MessageRepository, AttemptRepository } from '../../domain/ports.js';
import type {
  AttemptStatus,
  Channel,
  Client,
  DeliveryAttempt,
  Message,
  MessageStatus,
} from '../../domain/models.js';

interface MessageRow {
  id: string;
  client_id: string;
  recipient: string;
  text: string;
  channels: string;
  status: string;
  created_at: Date;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    clientId: row.client_id,
    recipient: row.recipient,
    text: row.text,
    channels: row.channels.split(',').map((c) => c as Channel),
    status: row.status as MessageStatus,
    attempts: [],
    createdAt: row.created_at,
  };
}

export class PgClientRepository implements ClientRepository {
  constructor(private readonly db: Queryable) {}

  async getIdByKeyHash(keyHash: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM clients WHERE api_key_hash = $1',
      [keyHash],
    );
    return rows[0]?.id ?? null;
  }

  async add(client: Client): Promise<void> {
    await this.db.query(
      'INSERT INTO clients (id, name, api_key_hash) VALUES ($1, $2, $3)',
      [client.id, client.name, client.apiKeyHash],
    );
  }
}

export class PgApiKeyLookup {
  private readonly repo: PgClientRepository;

  constructor(db: Queryable) {
    this.repo = new PgClientRepository(db);
  }

  getIdByKeyHash(keyHash: string): Promise<string | null> {
    return this.repo.getIdByKeyHash(keyHash);
  }
}

export class PgMessageRepository implements MessageRepository {
  constructor(private readonly db: Queryable) {}

  async save(message: Message): Promise<void> {
    await this.db.query(
      `INSERT INTO messages (id, client_id, recipient, text, channels, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [
        message.id,
        message.clientId,
        message.recipient,
        message.text,
        message.channels.map((c) => c.valueOf()).join(','),
        message.status.valueOf(),
      ],
    );
  }

  async get(messageId: string): Promise<Message | null> {
    const { rows } = await this.db.query<MessageRow>(
      'SELECT id, client_id, recipient, text, channels, status, created_at FROM messages WHERE id = $1',
      [messageId],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async recent(clientId: string, limit: number): Promise<Message[]> {
    const { rows } = await this.db.query<MessageRow>(
      `SELECT id, client_id, recipient, text, channels, status, created_at
       FROM messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [clientId, limit],
    );
    return rows.map(toMessage);
  }
}

interface AttemptRow {
  id: string;
  message_id: string;
  channel: string;
  status: string;
  latency_ms: number;
  error: string | null;
  created_at: Date;
}

function toAttempt(row: AttemptRow): DeliveryAttempt {
  return {
    id: row.id,
    messageId: row.message_id,
    channel: row.channel as Channel,
    status: row.status as AttemptStatus,
    latencyMs: row.latency_ms,
    error: row.error ?? undefined,
    createdAt: row.created_at,
  };
}

export class PgAttemptRepository implements AttemptRepository {
  constructor(private readonly db: Queryable) {}

  async save(attempt: DeliveryAttempt): Promise<void> {
    await this.db.query(
      `INSERT INTO delivery_attempts (id, message_id, channel, status, latency_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        attempt.id,
        attempt.messageId,
        attempt.channel.valueOf(),
        attempt.status.valueOf(),
        attempt.latencyMs,
        attempt.error ?? null,
      ],
    );
  }

  async statsByChannel(): Promise<Record<string, Record<string, number>>> {
    const { rows } = await this.db.query<{ channel: string; status: string; count: string }>(
      'SELECT channel, status, count(*)::text AS count FROM delivery_attempts GROUP BY channel, status',
    );
    const stats: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const byStatus = (stats[row.channel] ??= {});
      byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
    }
    return stats;
  }

  async forMessage(messageId: string): Promise<DeliveryAttempt[]> {
    const { rows } = await this.db.query<AttemptRow>(
      `SELECT id, message_id, channel, status, latency_ms, error, created_at
       FROM delivery_attempts WHERE message_id = $1 ORDER BY created_at`,
      [messageId],
    );
    return rows.map(toAttempt);
  }
}

export function newId(): string {
  return randomUUID();
}
