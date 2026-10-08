# builder: ставим зависимости в /app/deps
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/app/deps -r requirements.txt

# финальный образ: distroless, без шелла — атаковать нечего.
# SIGHUP доходит только при exec-форме ENTRYPOINT, никакого sh -c.
FROM gcr.io/distroless/python3-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/deps /app/deps
COPY app ./app
COPY config ./config
COPY migrations ./migrations
COPY alembic.ini main.py ./
ENV PYTHONPATH=/app:/app/deps/lib/python3.11/site-packages
EXPOSE 8000
ENTRYPOINT ["python", "main.py"]
