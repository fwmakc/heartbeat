/** Простой TTL-кеш в памяти: справочные данные не тянем из БД на каждый запрос. */

export type Loader<T> = () => Promise<T>;

interface Entry {
  readonly expiresAt: number;
  readonly value: unknown;
}

export class TTLCache {
  private readonly defaultTtlSeconds: number;
  private readonly store = new Map<string, Entry>();

  constructor(defaultTtlSeconds = 60) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /** Для async-loader'ов: resolve ключа/API ходит в БД. */
  async getOrSet<T>(key: string, loader: Loader<T>, ttlSeconds?: number): Promise<T> {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value as T;
    }
    const value = await loader();
    this.store.set(key, {
      expiresAt: Date.now() + (ttlSeconds ?? this.defaultTtlSeconds) * 1000,
      value,
    });
    return value;
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.store.clear();
    } else {
      this.store.delete(key);
    }
  }
}
