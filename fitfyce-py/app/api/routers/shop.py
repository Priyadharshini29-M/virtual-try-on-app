"""Port of ShopController.php + ProductDashboardController.php."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.db.session import get_db
from app.services import product_service

router = APIRouter()


@router.get("/shop")
async def get_shop(
    identity: Identity = Depends(require_api_key),
) -> JSONResponse:
    merchant = identity.merchant
    if merchant is None:
        return JSONResponse({"error": "Shop not found"}, status_code=404)

    return JSONResponse({
        "shop_id": merchant.id,
        "shop_domain": merchant.shopify_domain,
        "app_status": "enabled" if merchant.is_active else "disabled",
        "app_plan": merchant.plan,
        "shopify_plan": merchant.shopify_plan,
        "installed_theme_name": merchant.installed_theme_name,
        "installed_theme_id": merchant.installed_theme_id,
        "enabled_at": merchant.created_at.isoformat(),
        "updated_app": merchant.updated_at.isoformat(),
    })


@router.get("/shop/products")
async def get_shop_products(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    merchant_id = identity.id
    return JSONResponse({
        "shop_id": merchant_id,
        "collections": await product_service.get_collections(db, merchant_id),
        "products": await product_service.get_products_summary(db, merchant_id),
        "enabled_products_count": await product_service.get_enabled_products_count(db, merchant_id),
        "variant_map": await product_service.get_variant_mappings_map(db, merchant_id),
    })
