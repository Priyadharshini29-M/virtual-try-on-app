"""Port of PlanController.php."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.core.config import get_settings
from app.db.session import get_db
from app.models.merchant import Merchant, PlanLimit

router = APIRouter()


@router.get("/plan/limit")
async def check_limit(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    merchant = identity.merchant
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    # Auto-reset monthly count when the 30-day billing window has elapsed
    if merchant.billing_cycle_start is not None:
        elapsed_reset_at = merchant.billing_cycle_start + timedelta(days=30)
        if elapsed_reset_at <= date.today():
            merchant.tryon_count_month = 0
            merchant.billing_cycle_start = date.today()
            await db.commit()

    plan_row = (await db.execute(select(PlanLimit).where(PlanLimit.plan == merchant.plan))).scalar_one_or_none()
    limit = plan_row.monthly_tryon_limit if plan_row else 0
    used = merchant.tryon_count_month

    return JSONResponse({
        "ok": True,
        "plan": merchant.plan,
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "is_unlimited": limit == 0,
    })


@router.post("/plan/update")
async def update_plan(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    merchant = identity.merchant
    if merchant is None:
        return JSONResponse({"ok": False, "error": "Unauthorized"}, status_code=401)

    new_plan = str(body.get("plan", "")).strip()
    if new_plan not in get_settings().plans:
        return JSONResponse({"ok": False, "error": "Invalid plan"}, status_code=400)

    merchant.plan = new_plan
    await db.commit()

    return JSONResponse({"ok": True, "plan": new_plan})


@router.get("/plans")
async def list_plans(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    rows = (await db.execute(select(PlanLimit).order_by(PlanLimit.price_inr_monthly.asc()))).scalars().all()
    plans = [
        {
            "plan": r.plan,
            "monthly_tryon_limit": r.monthly_tryon_limit,
            "max_products": r.max_products,
            "analytics_enabled": r.analytics_enabled,
            "custom_api_enabled": r.custom_api_enabled,
            "branding_removable": r.branding_removable,
            "share_enabled": r.share_enabled,
            "price_inr_monthly": r.price_inr_monthly,
        }
        for r in rows
    ]
    return JSONResponse({"ok": True, "plans": plans})
