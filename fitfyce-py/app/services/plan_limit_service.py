"""Port of middleware/PlanLimitCheck.php."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import SHOPIFY_APP_URL
from app.models.merchant import Merchant, PlanLimit


async def check_plan_limit(db: AsyncSession, merchant: Merchant) -> dict | None:
    """Returns an error-response dict (429 payload) if the merchant is over
    their monthly limit, or `None` if they're clear to proceed. Callers
    return the dict as-is with status 429 — mirrors PHP's respondJson()+exit."""
    plan_row = (await db.execute(select(PlanLimit).where(PlanLimit.plan == merchant.plan))).scalar_one_or_none()
    if plan_row is None:
        return None

    limit = plan_row.monthly_tryon_limit
    used = merchant.tryon_count_month

    if limit > 0 and used >= limit:
        return {
            "error": "Monthly try-on limit reached",
            "plan": merchant.plan,
            "limit": limit,
            "used": used,
            "upgrade_url": SHOPIFY_APP_URL,
        }
    return None
