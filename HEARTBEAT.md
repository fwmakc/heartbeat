[drift]
# Служебный файл: сюда попадает контекст проекта.

[product]
name = "heartbeat — шлюз гарантированной доставки уведомлений"
client = "РФ B2B SMB: интернет-магазины, доставки, онлайн-школы, клиники"
mvp = "API интеграции + 3+ каналов с фолбэками + статистика доставки"

[stack]
python = "3.11"
framework = "FastAPI"
db = "Postgres (SQLAlchemy 2 + asyncpg, alembic)"
style = "монолит с чистыми слоями, никаких микросервисов до упора"

[rules]
versions = "в requirements.txt всё зафиксировано, «у меня и так работает» = саботаж"
entrypoint = "main.py — единственная точка входа"
secrets = "только в .env, в git идёт .env.example без секретов"
channels = "любой канал — за интерфейс NotificationChannel"
data = "справочные данные из БД держим в TTL-кеше в памяти"
config = "лимиты/тарифы — наружу в config/limits.yaml, SIGHUP перечитывает"
docker = "distroless, ENTRYPOINT только exec-формой, никакого sh -c"
deploy = "только тегированный релиз через CI, latest на прод запрещён"
environments = "staging -> prod, что не проехало staging, в prod не садится"
