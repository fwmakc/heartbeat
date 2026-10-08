/** Подключение к Postgres + мини-мигратор: .sql файлы по порядку, журнал в БД. */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Pool, type PoolClient } from 'pg';

export type Queryable = Pick<PoolClient, 'query'>;

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

/** Применяет *.sql из папки в лексикографическом порядке, каждый в транзакции. */
export async function migrate(pool: Pool, migrationsDir: string): Promise<string[]> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedNow.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`миграция ${file} не применилась: ${String(err)}`);
    } finally {
      client.release();
    }
  }
  return appliedNow;
}
