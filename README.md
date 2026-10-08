# heartbeat

Шлюз гарантированной доставки уведомлений для малого/среднего B2B: API интеграции,
каналы с фолбэками (telegram → max → sms → call → email), статистика доставки.

**Стек:** Node 24 LTS (pinned) + TypeScript 7 (нативный компилятор), strict,
Fastify, Postgres (`pg` без ORM), oxlint, distroless-образ. Один рантайм, один
локфайл, никаких микросервисов, пока не упрёмся.

## Архитектура

Монолит с чистыми слоями:

- `src/domain/` — сущности и порты, без зависимостей от инфраструктуры
- `src/application/` — сценарии: фолбэк-оркестратор, статистика, история
- `src/adapters/channels/` — любой канал за интерфейсом `BaseChannel` (`send -> DeliveryResult`).
  Telegram: ретраи на 429/5xx/сеть (пауза `backoffBaseMs * 2^attempt`, 429 уважает
  `Retry-After`), 4xx — постоянная ошибка, фолбэк срабатывает сразу; настраивается
  через `TELEGRAM_MAX_RETRIES` / `TELEGRAM_BACKOFF_BASE_MS`
- `src/adapters/storage/` — Postgres + мини-мигратор (`migrations/*.sql` по порядку)
- `src/infrastructure/` — конфиг, TTL-кеш, лимиты из YAML с reload по SIGHUP, ключи
- `src/api/` — Fastify-маршруты, кабинет, метрики

## Запуск

```bash
cp .env.example .env   # заполнить токены
npm ci
npm run build
npm run typecheck && npm run lint && npm test   # гейты, как в CI
node dist/main.js
```

Миграции применяются на старте автоматически. Или целиком: `docker compose up --build`.

## API

- `POST /v1/messages` — отправка; тело: `recipient`, `text`, опционально `channels`
  (иначе дефолтная цепочка фолбэка). Заголовок `X-API-Key`.
- `GET /v1/messages` — последние сообщения клиента (`?limit=20`).
- `GET /v1/messages/{id}` — сообщение + все попытки доставки по каналам.
- `GET /v1/stats` — статистика доставки по каналам и статусам.
- `GET /cabinet` — личный кабинет: статистика, история, детали попыток.
  Ключ вводится в форме и ходит только в заголовках — секретов в странице нет.
- `GET /docs` — OpenAPI/Swagger.
- `GET /v1/healthz`, `GET /metrics` — healthcheck и Prometheus.

### Выдача API-ключа

```bash
node dist/tools/addClient.js "Интернет-магазин Рога и Копыта"
```

Ключ показывается один раз, в БД лежит sha256; резолв ключа кешируется в памяти
(TTL), SIGHUP сбрасывает кеш вместе с лимитами.

## Конфиг лимитов и тарифов

`config/limits.yaml` монтируется снаружи. Перечитать без пересборки:

```bash
docker kill -s HUP <app-container>
```

В distroless нет шелла — поэтому ENTRYPOINT строго exec-форма, SIGHUP доходит.

## Эксплуатация

- **Деплой** — только тегированный релиз через CI (`git tag v0.2.0 && git push --tags`).
  Руками в прод никто не ходит. `latest` на проде запрещён.
- **Окружения** — staging и prod: что не проехало staging, в prod не садится.
- **Откат** — redeploy предыдущего тега, ~5 минут. Никаких правок по SSH в пятницу вечером.
- **Мониторинг** — `/metrics` в Prometheus, алерты в общий канал; алерт, если
  heartbeat-эндпоинт заглох.
- **Бэкапы** — Postgres ежедневно (`pg_dump` по cron), проверять восстановление, а не только наличие файла.

## Гейты качества (как в CI, порядок строгий)

```bash
npm ci
npm run lint        # oxlint
npm run typecheck   # tsc --noEmit (TS 7, strict + noUncheckedIndexedAccess)
npm test            # vitest
npm audit --omit=dev --audit-level=high
```

> Линтер — oxlint: typescript-eslint ещё не поддерживает TS 7 (peer < 6.1).
> Как только выйдет typescript-eslint с поддержкой TS 7 — возвращаемся.
