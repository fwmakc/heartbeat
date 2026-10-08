/** Выдача API-ключа клиенту. Ключ показываем один раз, в БД лежит sha256.
 *
 *   npm run build && node dist/tools/addClient.js "Интернет-магазин Рога и Копыта"
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { createPool, migrate } from '../adapters/storage/db.js';
import { PgClientRepository } from '../adapters/storage/repositories.js';
import { hashKey } from '../infrastructure/apiKeys.js';
import { loadConfig } from '../infrastructure/config.js';

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error('Использование: node dist/tools/addClient.js <имя клиента>');
    process.exit(2);
  }

  const apiKey = randomBytes(32).toString('base64url');
  const pool = createPool(loadConfig().databaseUrl);
  try {
    await migrate(pool, 'migrations');
    await new PgClientRepository(pool).add({
      id: randomUUID(),
      name,
      apiKeyHash: hashKey(apiKey),
      createdAt: new Date(),
    });
  } finally {
    await pool.end();
  }

  console.log(`Клиент: ${name}`);
  console.log(`API-ключ (показывается один раз): ${apiKey}`);
}

void main();
