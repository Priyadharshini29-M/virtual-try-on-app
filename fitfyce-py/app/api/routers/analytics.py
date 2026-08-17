"""Port of AnalyticsController.php."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.db.session import get_db
from app.services import analytics_service

router = APIRouter()

_NUMERIC_COLS = ["tryon_initiated", "add_to_cart_count", "buy_now_count", "save_count", "share_wa_count", "order_count", "revenue_inr"]


def _is_valid_date(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


@router.get("/analytics")
async def get_analytics(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
) -> JSONResponse:
    merchant_id = identity.id

    from_date = (from_ or (date.today() - timedelta(days=30)).isoformat()).strip()
    to_date = (to or date.today().isoformat()).strip()

    if not _is_valid_date(from_date) or not _is_valid_date(to_date):
        return JSONResponse({"error": "Invalid date format. Use YYYY-MM-DD"}, status_code=400)

    if from_date > to_date:
        from_date, to_date = to_date, from_date

    daily = await analytics_service.get_range(db, merchant_id, from_date, to_date)

    from_dt = datetime.strptime(from_date, "%Y-%m-%d").date()
    to_dt = datetime.strptime(to_date, "%Y-%m-%d").date()
    days = (to_dt - from_dt).days + 1
    prev_to = (from_dt - timedelta(days=1)).isoformat()
    prev_from = (from_dt - timedelta(days=days)).isoformat()
    prev_daily = await analytics_service.get_range(db, merchant_id, prev_from, prev_to)

    def sum_cols(rows: list[dict]) -> dict:
        totals = {c: 0.0 for c in _NUMERIC_COLS}
        for row in rows:
            for c in _NUMERIC_COLS:
                totals[c] += float(row.get(c, 0) or 0)
        return totals

    cur = sum_cols(daily)
    prev = sum_cols(prev_daily)

    cur_cart_rate = (cur["add_to_cart_count"] / cur["tryon_initiated"]) * 100 if cur["tryon_initiated"] > 0 else 0.0
    cur_purch_rate = (cur["order_count"] / cur["tryon_initiated"]) * 100 if cur["tryon_initiated"] > 0 else 0.0
    prev_cart_rate = (prev["add_to_cart_count"] / prev["tryon_initiated"]) * 100 if prev["tryon_initiated"] > 0 else 0.0
    prev_purch_rate = (prev["order_count"] / prev["tryon_initiated"]) * 100 if prev["tryon_initiated"] > 0 else 0.0

    summary = {
        "tryon_initiated": int(cur["tryon_initiated"]),
        "add_to_cart_count": int(cur["add_to_cart_count"]),
        "order_count": int(cur["order_count"]),
        "revenue_inr": round(cur["revenue_inr"], 2),
        "save_count": int(cur["save_count"]),
        "share_wa_count": int(cur["share_wa_count"]),
        "tryon_trend": analytics_service.trend_str(cur["tryon_initiated"], prev["tryon_initiated"]),
        "cart_rate_trend": analytics_service.trend_str(cur_cart_rate, prev_cart_rate),
        "purch_rate_trend": analytics_service.trend_str(cur_purch_rate, prev_purch_rate),
        "revenue_trend": analytics_service.trend_str(cur["revenue_inr"], prev["revenue_inr"]),
        "cart_trend": analytics_service.trend_str(cur["add_to_cart_count"], prev["add_to_cart_count"]),
        "save_trend": analytics_service.trend_str(cur["save_count"], prev["save_count"]),
        "share_wa_trend": analytics_service.trend_str(cur["share_wa_count"], prev["share_wa_count"]),
        "order_trend": analytics_service.trend_str(cur["order_count"], prev["order_count"]),
    }

    return JSONResponse({
        "summary": summary,
        "charts": analytics_service.build_charts(daily),
        "top_products": await analytics_service.get_top_products(db, merchant_id, from_date, to_date),
        "device_split": await analytics_service.get_device_split(db, merchant_id, from_date, to_date),
    })
