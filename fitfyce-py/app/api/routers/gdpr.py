"""Shopify's 3 mandatory GDPR webhook topics — /gdpr/customers/data_request,
/gdpr/customers/redact, /gdpr/shop/redact.

These are called by fitfyce-shopify/app/routes/api.webhook.jsx but were
never implemented anywhere in the PHP backend (confirmed absent from both
router.php and api.php) — a real pre-existing production gap the migration
plan called out to fix, not something to silently port as broken. Built
here as genuine (if minimal) implementations:

- customers/data_request / customers/redact: this schema stores no
  customer-identifying data anywhere (no email/customer_id column on any
  table — tryon_sessions/tryon_conversions are keyed by session/order id
  only, order-level PII lives in Shopify itself). Acknowledged, nothing to
  export or delete on our side.
- shop/redact: fires 48+ hours after uninstall — deletes the merchant row,
  which cascades (ON DELETE CASCADE) through every owned table: settings,
  products, variant mappings, sessions, conversions, analytics, studio
  sessions, generations, saved models, assets.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.core.logging import get_logger
from app.db.session import get_db
from app.services.merchant_service import find_merchant_by_domain

router = APIRouter()
logger = get_logger(__name__)


@router.post("/gdpr/customers/data_request")
async def customers_data_request(
    identity: Identity = Depends(require_api_key),
    body: dict = Body(...),
) -> JSONResponse:
    logger.info("GDPR customers/data_request for shop=%s customer=%s", body.get("shop_domain"), body.get("customer"))
    return JSONResponse({"ok": True})


@router.post("/gdpr/customers/redact")
async def customers_redact(
    identity: Identity = Depends(require_api_key),
    body: dict = Body(...),
) -> JSONResponse:
    logger.info("GDPR customers/redact for shop=%s customer=%s", body.get("shop_domain"), body.get("customer"))
    return JSONResponse({"ok": True})


@router.post("/gdpr/shop/redact")
async def shop_redact(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    domain = str(body.get("shop_domain", "")).strip()
    if domain == "":
        return JSONResponse({"error": "shop_domain is required"}, status_code=400)

    merchant = await find_merchant_by_domain(db, domain)
    if merchant is not None:
        await db.delete(merchant)
        await db.commit()
        logger.info("GDPR shop/redact: deleted merchant id=%s domain=%s", merchant.id, domain)
    else:
        logger.info("GDPR shop/redact: no merchant found for domain=%s (already deleted or never registered)", domain)

    return JSONResponse({"ok": True})
