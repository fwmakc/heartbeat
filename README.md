# heartbeat

Шлюз гарантированной доставки уведомлений для малого/среднего B2B: API интеграции,
каналы с фолбэками (telegram → max → sms → call → email), статистика доставки.

## Архитектура

Монолит с чистыми слоями, микросервисы начнём, когда упрёмся:

- `app/domain/` — сущности и порты, без зависимостей от инфраструктуры
- `app/application/` — сценарии: фолбэк-оркестратор, статистика
- `app/adapters/channels/` — любой канал за интерфейсом `BaseChannel` (`send -> DeliveryResult`).
  Telegram: ретраи на 429/5xx/сеть (пауза `backoff_base * 2^attempt`, 429 уважает
  `Retry-After`), 4xx — постоянная ошибка, фолбэк срабатывает сразу; поведение
  настраивается через `TELEGRAM_MAX_RETRIES` / `TELEGRAM_BACKOFF_BASE`.
- `app/adapters/storage/` — Postgres (SQLAlchemy 2 + asyncpg), alembic-миграции
- `app/infrastructure/` — настройки, TTL-кеш, лимиты из YAML с reload по SIGHUP
- `app/api/` — FastAPI-роуты

## Запуск

```bash
cp .env.example .env   # заполнить токены
pip install -r requirements.txt
alembic upgrade head
python main.py         # точка входа одна
```

Или целиком: `docker compose up --build`.

## API

- `POST /v1/messages` — отправка; тело: `recipient`, `text`, опционально `channels`
  (иначе дефолтная цепочка фолбэка). Заголовок `X-API-Key`.
- `GET /v1/messages` — последние сообщения клиента (`?limit=20`).
- `GET /v1/messages/{id}` — сообщение + все попытки доставки по каналам.
- `GET /v1/stats` — статистика доставки по каналам и статусам.
- `GET /cabinet` — личный кабинет: статистика, история, детали попыток.
  Ключ вводится в форме и ходит только в заголовках — секретов в странице нет.
- `GET /v1/healthz`, `GET /metrics` — healthcheck и Prometheus.

### Выдача API-ключа

```bash
python -m app.tools.add_client "Интернет-магазин Рога и Копыта"
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

- **Деплой** — только тегированный релиз через CI (`git tag v0.1.0 && git push --tags`).
  Руками в прод никто не ходит. `latest` на проде запрещён.
- **Окружения** — staging и prod: что не проехало staging, в prod не садится.
- **Откат** — redeploy предыдущего тега, ~5 минут. Никаких правок по SSH в пятницу вечером.
- **Мониторинг** — `/metrics` в Prometheus, алерты в общий канал; алерт, если
  heartbeat-эндпоинт заглох.
- **Бэкапы** — Postgres ежедневно (`pg_dump` по cron), проверять восстановление, а не только наличие файла.

## Тесты

```bash
pip install -r requirements-dev.txt
ruff check . && pytest -q
```
