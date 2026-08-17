"""Port of MerchantController.php."""

from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key, verify_shopify_hmac
from app.core.logging import get_logger
from app.db.session import get_db
from app.services.merchant_service import create_merchant, find_merchant_by_domain

router = APIRouter()
logger = get_logger(__name__)


def _normalize(value: str) -> str:
    return re.sub(r"^https?://", "", value.strip(), flags=re.IGNORECASE).rstrip("/")


@router.get("/merchant/by-domain")
async def by_domain(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    domain: str = Query(default=""),
) -> JSONResponse:
    domain = domain.strip()
    if domain == "":
        return JSONResponse({"error": "domain is required"}, status_code=400)

    merchant = await find_merchant_by_domain(db, domain)
    if merchant is None:
        return JSONResponse({"error": "Merchant not found"}, status_code=404)

    return JSONResponse({
        "id": merchant.id,
        "shopify_domain": merchant.shopify_domain,
        "plan": merchant.plan,
        "api_key": merchant.api_key,
        "is_active": merchant.is_active,
        "tryon_count_month": merchant.tryon_count_month,
    })


@router.post("/merchant/register")
async def register(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    logger.info("register called: %s", body)

    domain = _normalize(str(body.get("shopify_domain", "")))
    store_id = _normalize(str(body.get("shopify_store_id", "")))
    token = str(body.get("access_token", "")).strip()

    if domain == "" or store_id == "":
        logger.error("register missing required fields domain=%r store_id=%r", domain, store_id)
        return JSONResponse({"error": "shopify_domain and shopify_store_id are required"}, status_code=400)

    existing = await find_merchant_by_domain(db, domain)
    if existing is not None:
        if token:
            existing.access_token = token
        existing.is_active = True
        existing.shopify_domain = domain
        await db.commit()
        return JSONResponse({"id": existing.id, "api_key": existing.api_key, "created": False})

    if token == "":
        logger.error("register: access_token required for new merchant domain=%r", domain)
        return JSONResponse({"error": "access_token is required for new merchant registration"}, status_code=400)

    merchant = await create_merchant(db, domain, store_id, token)
    return JSONResponse({"id": merchant.id, "api_key": merchant.api_key, "created": True})


@router.post("/merchant/deactivate")
async def deactivate(
    db: AsyncSession = Depends(get_db),
    raw_body: bytes = Depends(verify_shopify_hmac),
) -> JSONResponse:
    import json

    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        body = {}

    domain = str(body.get("shopify_domain", "")).strip()
    if domain == "":
        return JSONResponse({"error": "shopify_domain is required"}, status_code=400)

    merchant = await find_merchant_by_domain(db, domain)
    if merchant is not None:
        merchant.is_active = False
        await db.commit()

    return JSONResponse({"ok": True})
