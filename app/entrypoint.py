"""Точка входа: uvicorn + обработчик SIGHUP живёт в главном потоке процесса.

Distroless не имеет шелла — запуск только exec-формой:
    ENTRYPOINT ["python", "-m", "app.entrypoint"]
"""

from __future__ import annotations

import signal

import uvicorn

from app.infrastructure.limits import LimitsProvider
from app.infrastructure.settings import get_settings
from app.main_app import create_app


def main() -> None:
    settings = get_settings()
    app = create_app(settings)

    # LimitsProvider в create_app уже ставит обработчик SIGHUP; здесь лишь
    # страховка: сигнал должен ловить главный поток, как с uvicorn по умолчанию.
    limits: LimitsProvider = app.state.limits
    try:
        signal.signal(signal.SIGHUP, lambda *_: limits.reload())
    except (AttributeError, ValueError):
        pass

    uvicorn.run(app, host=settings.app_host, port=settings.app_port, log_level="info")


if __name__ == "__main__":
    main()
