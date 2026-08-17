"""Port of ProductController.php."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, get_shop_domain, require_api_key
from app.db.session import get_db
from app.services import product_service
from app.services.merchant_service import find_merchant_by_domain

router = APIRouter()

_REQUIRED_SYNC_FIELDS = ["shopify_product_id", "shopify_product_gid"]
_REQUIRED_MAPPING_FIELDS = ["product_id", "shopify_variant_id", "shopify_variant_gid", "tryon_image_url"]


@router.get("/products")
async def list_products(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    return JSONResponse(await product_service.list_for_merchant(db, identity.id))


@router.post("/products/sync")
async def sync_product(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    for field in _REQUIRED_SYNC_FIELDS:
        if not body.get(field):
            return JSONResponse({"error": f"Missing field: {field}"}, status_code=400)

    try:
        product_id = await product_service.sync_product(db, identity.id, body)
        return JSONResponse({"id": product_id})
    except Exception as exc:  # noqa: BLE001 — mirrors PHP's catch-all + error message passthrough
        return JSONResponse({"error": f"Product sync failed: {exc}"}, status_code=500)


@router.get("/variants/mapping")
async def get_mappings(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    product_id: int | None = Query(default=None),
) -> JSONResponse:
    if product_id is None:
        return JSONResponse({"error": "product_id is required"}, status_code=400)
    return JSONResponse(await product_service.get_variant_mappings(db, product_id))


async def _resolve_merchant_id_for_mapping(identity: Identity, request: Request, db: AsyncSession) -> int:
    """Master-key calls (id=0) resolve the real merchant from ?shop= or
    X-Shop-Domain, mirroring ProductController::saveMapping()/updateMapping()."""
    if not identity.is_master:
        return identity.id

    shop = request.query_params.get("shop") or request.headers.get("X-Shop-Domain") or ""
    shop = shop.strip()
    if shop:
        merchant = await find_merchant_by_domain(db, shop)
        if merchant:
            return merchant.id
    return 0


@router.post("/variants/mapping")
async def save_mapping(
    request: Request,
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    for field in _REQUIRED_MAPPING_FIELDS:
        if not body.get(field):
            return JSONResponse({"error": f"Missing field: {field}"}, status_code=400)

    try:
        merchant_id = await _resolve_merchant_id_for_mapping(identity, request, db)
        await product_service.save_variant_mapping(db, merchant_id, int(body["product_id"]), body)
        return JSONResponse({"ok": True})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"Save failed: {exc}"}, status_code=500)


@router.put("/variants/mapping/{mapping_id}")
async def update_mapping(
    mapping_id: int,
    request: Request,
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    # mapping_id is unused — matches PHP's updateMapping(), which upserts by
    # (product_id, shopify_variant_id) exactly like saveMapping() and never
    # reads the path parameter.
    for field in _REQUIRED_MAPPING_FIELDS:
        if not body.get(field):
            return JSONResponse({"error": f"Missing field: {field}"}, status_code=400)

    try:
        merchant_id = await _resolve_merchant_id_for_mapping(identity, request, db)
        await product_service.save_variant_mapping(db, merchant_id, int(body["product_id"]), body)
        return JSONResponse({"ok": True})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"Update failed: {exc}"}, status_code=500)
