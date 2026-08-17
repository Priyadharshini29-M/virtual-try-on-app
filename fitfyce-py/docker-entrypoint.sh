#!/bin/sh
# Entrypoint for the fitfyce-py image. Runs Alembic migrations once (API
# process only — the worker process would otherwise race it on every
# deploy/restart), then execs the requested process.
#
#   docker run fitfyce-py api      → uvicorn (default)
#   docker run fitfyce-py worker   → arq cron worker (cleanup_results)
set -e

case "$1" in
  api)
    alembic upgrade head
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000
    ;;
  worker)
    exec arq app.workers.arq_app.WorkerSettings
    ;;
  *)
    exec "$@"
    ;;
esac
