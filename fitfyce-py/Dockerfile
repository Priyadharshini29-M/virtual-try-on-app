# fitfyce-py — FastAPI + PostgreSQL backend. Single image serves both the
# API (default CMD) and the arq worker (overridden via fly.toml's
# [processes] or `docker run ... arq app.workers.arq_app.WorkerSettings`).
FROM python:3.12-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install --no-cache-dir --prefix=/install .

# ── Runtime stage ────────────────────────────────────────────────────────
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /install /usr/local
COPY --from=build /app/app ./app
COPY --from=build /app/alembic ./alembic
COPY --from=build /app/alembic.ini ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /data/storage \
    && adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app /data
USER appuser

ENV STORAGE_DIR=/data/storage
EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["api"]
