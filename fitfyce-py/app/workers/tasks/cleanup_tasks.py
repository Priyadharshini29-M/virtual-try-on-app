"""Port of cron/cleanup_results.php — 3 steps: expire results/*, expire
temp/*+.meta sidecars, null out expired tryon_sessions.result_image_url.

Runs as an arq cron job (see app/workers/arq_app.py) instead of a system
crontab entry.
"""

from __future__ import annotations

import json
import time
from datetime import datetime

from sqlalchemy import update

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.tryon import TryOnSession
from app.services import storage_service

logger = get_logger(__name__)

_RESULT_EXTENSIONS = (".jpg", ".jpeg", ".png")


async def cleanup_results(ctx: dict) -> dict:
    settings = get_settings()
    cutoff_ts = time.time() - (settings.results_ttl_hours * 3600)

    deleted_results = _cleanup_expired_results(cutoff_ts)
    deleted_temp = _cleanup_expired_temp()
    nullified = await _nullify_expired_result_urls()

    logger.info(
        "Cleanup finished: deleted %d expired result file(s), %d expired temp file(s), "
        "nullified %d expired result_image_url row(s) in DB.",
        deleted_results, deleted_temp, nullified,
    )
    return {"deleted_results": deleted_results, "deleted_temp": deleted_temp, "db_nullified": nullified}


def _cleanup_expired_results(cutoff_ts: float) -> int:
    """Permanent assets (saved models, generations, infographics) live in
    separate library/ and generations/ directories this never touches; only
    the ephemeral results/ directory is in scope."""
    deleted = 0
    for path in storage_service.results_dir().iterdir():
        if path.is_file() and path.suffix.lower() in _RESULT_EXTENSIONS and path.stat().st_mtime < cutoff_ts:
            path.unlink(missing_ok=True)
            deleted += 1
    return deleted


def _cleanup_expired_temp() -> int:
    deleted = 0
    temp_dir = storage_service.temp_dir()
    now = time.time()

    for meta_file in storage_service.temp_meta_dir().glob("*.json"):
        try:
            meta = json.loads(meta_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(meta, dict):
            continue

        expires_at = meta.get("expires_at") or 0
        if expires_at and expires_at < now:
            file_uuid = meta.get("uuid") or ""
            if file_uuid:
                img_file = temp_dir / f"{file_uuid}.jpg"
                if img_file.is_file():
                    img_file.unlink(missing_ok=True)
                    deleted += 1
            meta_file.unlink(missing_ok=True)
    return deleted


async def _nullify_expired_result_urls() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(TryOnSession)
            .where(TryOnSession.result_expires_at < datetime.utcnow(), TryOnSession.result_image_url.is_not(None))
            .values(result_image_url=None)
        )
        await db.commit()
        return result.rowcount or 0
