"""arq worker entrypoint — replaces cron/cleanup_results.php's crontab
entry (`0 * * * *`, top of every hour) with arq's built-in cron scheduling.

Run with:
    arq app.workers.arq_app.WorkerSettings
"""

from __future__ import annotations

from arq import cron
from arq.connections import RedisSettings

from app.core.config import get_settings
from app.workers.tasks.cleanup_tasks import cleanup_results


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    cron_jobs = [cron(cleanup_results, hour=None, minute=0)]
