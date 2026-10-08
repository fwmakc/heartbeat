"""Выдача API-ключа клиенту. Ключ показываем один раз, в БД лежит sha256.

    python -m app.tools.add_client "Интернет-магазин Рога и Копыта"
"""

from __future__ import annotations

import asyncio
import secrets
import sys
import uuid

from app.adapters.storage.engine import create_engine, create_session_factory
from app.adapters.storage.repositories import PgClientRepository
from app.domain.models import Client
from app.infrastructure.api_keys import hash_key
from app.infrastructure.settings import get_settings


async def main() -> None:
    if len(sys.argv) != 2:
        print("Использование: python -m app.tools.add_client <имя клиента>", file=sys.stderr)
        raise SystemExit(2)

    name = sys.argv[1]
    api_key = secrets.token_urlsafe(32)
    engine = create_engine(get_settings().database_url)
    session_factory = create_session_factory(engine)
    try:
        async with session_factory() as session:
            await PgClientRepository(session).add(
                Client(id=uuid.uuid4(), name=name, api_key_hash=hash_key(api_key))
            )
    finally:
        await engine.dispose()

    print(f"Клиент: {name}")
    print(f"API-ключ (показывается один раз): {api_key}")


if __name__ == "__main__":
    asyncio.run(main())
