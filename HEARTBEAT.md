[drift]
# Служебный файл: сюда попадает контекст проекта.

[product]
name = "heartbeat — шлюз гарантированной доставки уведомлений"
client = "РФ B2B SMB: интернет-магазины, доставки, онлайн-школы, клиники"
mvp = "API интеграции + каналы с фолбэками + кабинет со статистикой доставки"

[stack]
runtime = "Node 24 LTS (pinned, .nvmrc), не Bun — решение команды, тема закрыта"
language = "TypeScript 7 (нативный компилятор), strict + noUncheckedIndexedAccess"
framework = "Fastify (+ @fastify/swagger, OpenAPI на /docs)"
db = "Postgres, драйвер pg без ORM, миграции migrations/*.sql (мини-мигратор)"
lint = "oxlint: typescript-eslint пока не поддерживает TS 7 (peer < 6.1) — вернёмся с их v9"
tests = "vitest"
style = "монолит с чистыми слоями, никаких микросервисов до упора"

[rules]
versions = "package-lock.json в git, установка только npm ci"
entrypoint = "src/main.ts -> dist/main.js — единственная точка входа"
secrets = "только в .env, в git идёт .env.example без секретов"
channels = "любой канал — за интерфейс NotificationChannel (send -> DeliveryResult)"
data = "справочные данные из БД держим в TTL-кеше в памяти"
config = "лимиты/тарифы — наружу в config/limits.yaml, SIGHUP перечитывает"
docker = "distroless nodejs24, ENTRYPOINT только exec-формой, никакого sh -c"
ci = "гейты по порядку: oxlint -> tsc --noEmit -> vitest -> npm audit --omit=dev"
deploy = "только тегированный релиз через CI, latest на прод запрещён"
environments = "staging -> prod, что не проехало staging, в prod не садится"
