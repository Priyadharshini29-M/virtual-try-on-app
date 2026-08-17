"""Port of ConversionController.php."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.core.constants import CONVERSION_ATTRIBUTION_DAYS
from app.db.session import get_db
from app.services import analytics_service
from app.services.merchant_service import find_merchant_by_domain

router = APIRouter()


@router.post("/conversion")
async def record_conversion(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    merchant_id = identity.id

    # Webhook calls use the master key (id=0) — resolve the real merchant
    # from the shop domain in the payload.
    if identity.is_master:
        domain = str(body.get("merchant_domain", "")).strip()
        if domain == "":
            return JSONResponse({"error": "merchant_domain required for webhook calls"}, status_code=400)
        merchant_row = await find_merchant_by_domain(db, domain)
        if merchant_row is None or not merchant_row.is_active:
            return JSONResponse({"ok": True})  # Unknown shop — silent OK so Shopify doesn't retry
        merchant_id = merchant_row.id

    shopify_order_id = body.get("shopify_order_id")
    if shopify_order_id is None:
        return JSONResponse({"error": "shopify_order_id is required"}, status_code=400)
    shopify_order_id = int(shopify_order_id)

    order_value_inr = float(body["order_value_inr"]) if body.get("order_value_inr") is not None else None
    line_items = body.get("line_items") if isinstance(body.get("line_items"), list) else []
    webhook_event_id = str(body.get("webhook_event_id", "")).strip()
    shopify_order_gid = body.get("shopify_order_gid")

    # ── Dedup: skip already-processed webhook events ──────────────────────
    if webhook_event_id != "":
        dedup = await db.execute(
            text("""
                INSERT INTO analytics_webhook_events (webhook_event_id, merchant_id, event_type)
                VALUES (:wid, :mid, :etype)
                ON CONFLICT (webhook_event_id) DO NOTHING
            """),
            {"wid": webhook_event_id, "mid": merchant_id, "etype": str(body.get("event_type", "orders/paid"))},
        )
        await db.commit()
        if dedup.rowcount == 0:
            return JSONResponse({"ok": True, "duplicate": True})

    for item in line_items:
        product_id = item.get("product_id")
        properties = item.get("properties") if isinstance(item.get("properties"), dict) else {}

        fitfyce_session = str(properties.get("_fitfyce_session", "")).strip()
        session_id = None

        if fitfyce_session != "":
            row = (
                await db.execute(
                    text("SELECT id FROM tryon_sessions WHERE id = :sid AND merchant_id = :mid LIMIT 1"),
                    {"sid": fitfyce_session, "mid": merchant_id},
                )
            ).first()
            session_id = row[0] if row else None

        if session_id is None and product_id is not None:
            cutoff = date.today() - timedelta(days=CONVERSION_ATTRIBUTION_DAYS)
            row = (
                await db.execute(
                    text("""
                        SELECT ts.id FROM tryon_sessions ts
                        JOIN products p ON p.id = ts.product_id
                        WHERE ts.merchant_id = :mid
                          AND p.shopify_product_id = :pid
                          AND ts.status = 'completed'
                          AND ts.created_at >= :cutoff
                        ORDER BY ts.created_at DESC
                        LIMIT 1
                    """),
                    {"mid": merchant_id, "pid": int(product_id), "cutoff": cutoff},
                )
            ).first()
            session_id = row[0] if row else None

        if session_id is None:
            continue

        try:
            await db.execute(
                text("""
                    INSERT INTO tryon_conversions
                        (tryon_session_id, merchant_id, shopify_order_id, shopify_order_gid, order_value_inr)
                    VALUES (:sid, :mid, :oid, :ogid, :val)
                    ON CONFLICT (shopify_order_id, tryon_session_id) DO NOTHING
                """),
                {"sid": session_id, "mid": merchant_id, "oid": shopify_order_id, "ogid": shopify_order_gid, "val": order_value_inr},
            )
            await db.commit()
        except IntegrityError:
            await db.rollback()

    await analytics_service.upsert_daily(db, merchant_id, date.today(), {"order_count": 1, "revenue_inr": order_value_inr or 0})

    return JSONResponse({"ok": True})
