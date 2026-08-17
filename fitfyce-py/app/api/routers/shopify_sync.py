"""Port of ShopifySyncController.php."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.db.session import get_db
from app.integrations.shopify_admin_client import ShopifyAdminClient
from app.models.catalog import Collection, Product
from app.services import product_service

router = APIRouter()


@router.post("/shopify/sync")
async def sync(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if identity.is_master or identity.merchant is None:
        return JSONResponse({"error": "Merchant not identified — use merchant api_key, not master key"}, status_code=400)

    merchant = identity.merchant
    if not merchant.access_token:
        return JSONResponse({"error": "No access token found for merchant"}, status_code=400)

    api = ShopifyAdminClient(merchant.shopify_domain, merchant.access_token)
    log: dict = {}

    # ── 1. Fetch all collections (custom + smart) ────────────────────────
    custom_collections = await api.fetch_all("custom_collections", "custom_collections")
    smart_collections = await api.fetch_all("smart_collections", "smart_collections")
    all_collections = custom_collections + smart_collections
    log["collections_fetched"] = len(all_collections)

    collection_map: dict[int, dict] = {}
    for col in all_collections:
        col_id = int(col["id"])
        col_gid = f"gid://shopify/Collection/{col_id}"

        existing = (
            await db.execute(
                select(Collection).where(Collection.merchant_id == merchant.id, Collection.shopify_collection_id == col_id)
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(Collection(
                merchant_id=merchant.id, shopify_collection_id=col_id, shopify_collection_gid=col_gid,
                title=col["title"], handle=col["handle"], products_count=col.get("products_count", 0),
            ))
        else:
            existing.shopify_collection_gid = col_gid
            existing.title = col["title"]
            existing.handle = col["handle"]
        await db.commit()

        collection_map[col_id] = {
            "collection_id": col_id, "collection_gid": col_gid,
            "collection_title": col["title"], "collection_handle": col["handle"],
        }

    # ── 2. Build product→collection map ──────────────────────────────────
    product_col_map: dict[int, int] = {}
    for col_id in collection_map:
        col_products = await api.fetch_all("products", "products", {"collection_id": col_id, "fields": "id"})
        for cp in col_products:
            pid = int(cp["id"])
            product_col_map.setdefault(pid, col_id)
    log["products_mapped_to_collections"] = len(product_col_map)

    # ── 3. Fetch + sync all products ─────────────────────────────────────
    products = await api.fetch_all("products", "products", {"fields": "id,title,handle,status,variants"})
    log["products_fetched"] = len(products)
    synced = 0

    for p in products:
        shopify_product_id = int(p["id"])
        shopify_product_gid = f"gid://shopify/Product/{shopify_product_id}"
        col_id = product_col_map.get(shopify_product_id)
        col_info = collection_map.get(col_id, {}) if col_id else {}

        existing_product = (
            await db.execute(
                select(Product).where(Product.merchant_id == merchant.id, Product.shopify_product_id == shopify_product_id)
            )
        ).scalar_one_or_none()
        is_tryon_enabled = existing_product.is_tryon_enabled if existing_product else False

        await product_service.sync_product(db, merchant.id, {
            "shopify_product_id": shopify_product_id,
            "shopify_product_gid": shopify_product_gid,
            "collection_id": col_info.get("collection_id"),
            "collection_gid": col_info.get("collection_gid"),
            "collection_title": col_info.get("collection_title"),
            "collection_handle": col_info.get("collection_handle"),
            "is_tryon_enabled": is_tryon_enabled,
        })
        synced += 1

    log["products_synced"] = synced

    return JSONResponse({"ok": True, "log": log})
