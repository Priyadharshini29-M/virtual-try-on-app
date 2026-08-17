"""Port of db/SessionRepo.php."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tryon import TryOnSession

_VALID_ACTIONS = ["add_to_cart", "buy_now", "save_image", "share_wa"]


async def create(db: AsyncSession, merchant_id: int, product_id: int | None, variant_id: int | None,
                  device_type: str | None, country_code: str | None) -> uuid.UUID:
    session = TryOnSession(
        merchant_id=merchant_id,
        product_id=product_id,
        variant_id=variant_id,
        status="pending",
        device_type=device_type,
        country_code=country_code,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session.id


async def update_status(db: AsyncSession, session_id: str, status: str, **extra) -> None:
    session = (await db.execute(select(TryOnSession).where(TryOnSession.id == session_id))).scalar_one_or_none()
    if session is None:
        return
    session.status = status
    for col in ["result_image_url", "result_seed", "result_expires_at", "error_message",
                "api_request_at", "api_response_at", "api_latency_ms"]:
        if col in extra:
            setattr(session, col, extra[col])
    await db.commit()


async def track_action(db: AsyncSession, session_id: str, action: str) -> None:
    if action not in _VALID_ACTIONS:
        return
    session = (await db.execute(select(TryOnSession).where(TryOnSession.id == session_id))).scalar_one_or_none()
    if session is None:
        return
    setattr(session, f"action_{action}", True)
    await db.commit()


async def find_by_id(db: AsyncSession, session_id: str) -> TryOnSession | None:
    try:
        uuid.UUID(session_id)
    except ValueError:
        return None
    return (await db.execute(select(TryOnSession).where(TryOnSession.id == session_id))).scalar_one_or_none()
