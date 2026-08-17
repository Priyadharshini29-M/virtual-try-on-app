"""Port of db/ProductRepo.php + db/ProductSummaryRepo.php.

The self-healing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` calls in the PHP
originals are gone entirely here — every column they defensively added
(`variant_image_mappings.garment_type/avatar_sex/clothing_prompt/
is_approved`, `products.handle`) already exists from day one via Alembic.
"""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Collection, Product, ProductCollectionMap, VariantImageMapping
from app.models.merchant import MerchantSettings
from app.utils.serialization import row_to_dict


async def sync_product(db: AsyncSession, merchant_id: int, data: dict) -> int:
    """Port of `ProductRepo::syncProduct()` — upsert by shopify_product_id."""
    domain_row = (await db.execute(text("SELECT shopify_domain FROM merchants WHERE id = :mid"), {"mid": merchant_id})).first()
    shop_domain = domain_row[0] if domain_row else None

    shopify_product_id = int(data["shopify_product_id"])

    existing = (
        await db.execute(
            select(Product).where(Product.merchant_id == merchant_id, Product.shopify_product_id == shopify_product_id)
        )
    ).scalar_one_or_none()

    handle = data.get("handle")
    if existing is None:
        product = Product(
            merchant_id=merchant_id,
            shopify_domain=shop_domain,
            shopify_product_id=shopify_product_id,
            shopify_product_gid=data["shopify_product_gid"],
            collection_id=data.get("collection_id"),
            collection_title=data.get("collection_title"),
            collection_handle=data.get("collection_handle"),
            collection_products=data.get("collection_products"),
            shopify_variants=data.get("shopify_variants"),
            is_tryon_enabled=bool(data.get("is_tryon_enabled", True)),
            handle=handle,
        )
        db.add(product)
        await db.flush()
    else:
        product = existing
        product.shopify_domain = shop_domain
        product.shopify_product_gid = data["shopify_product_gid"]
        product.collection_id = data.get("collection_id")
        product.collection_title = data.get("collection_title")
        product.collection_handle = data.get("collection_handle")
        product.collection_products = data.get("collection_products")
        product.shopify_variants = data.get("shopify_variants")
        product.is_tryon_enabled = bool(data.get("is_tryon_enabled", True))
        # COALESCE(VALUES(handle), handle) semantics — only overwrite if a
        # non-null handle was actually supplied.
        if handle:
            product.handle = handle

    await db.commit()
    await db.refresh(product)

    if data.get("collection_id"):
        await _upsert_collection_from_product(db, merchant_id, product.id, data)

    await sync_products_json(db, merchant_id)
    await sync_enabled_products_json(db, merchant_id)

    return product.id


async def _upsert_collection_from_product(db: AsyncSession, merchant_id: int, product_id: int, data: dict) -> None:
    collection_shopify_id = int(data["collection_id"])
    existing = (
        await db.execute(
            select(Collection).where(
                Collection.merchant_id == merchant_id, Collection.shopify_collection_id == collection_shopify_id
            )
        )
    ).scalar_one_or_none()

    products_count = (
        await db.execute(
            select(func.count()).select_from(Product).where(
                Product.merchant_id == merchant_id, Product.collection_id == collection_shopify_id
            )
        )
    ).scalar_one()

    if existing is None:
        collection = Collection(
            merchant_id=merchant_id,
            shopify_collection_id=collection_shopify_id,
            shopify_collection_gid=data.get("collection_gid") or f"gid://shopify/Collection/{collection_shopify_id}",
            title=data["collection_title"],
            handle=data["collection_handle"],
            products_count=products_count,
        )
        db.add(collection)
        await db.flush()
    else:
        collection = existing
        if data.get("collection_gid"):
            collection.shopify_collection_gid = data["collection_gid"]
        collection.title = data["collection_title"]
        collection.handle = data["collection_handle"]
        collection.products_count = products_count

    await db.commit()
    await db.refresh(collection)

    link_exists = (
        await db.execute(
            select(ProductCollectionMap).where(
                ProductCollectionMap.product_id == product_id, ProductCollectionMap.collection_id == collection.id
            )
        )
    ).scalar_one_or_none()
    if link_exists is None:
        db.add(ProductCollectionMap(product_id=product_id, collection_id=collection.id))
        await db.commit()


async def sync_products_json(db: AsyncSession, merchant_id: int) -> None:
    """Rebuilds `merchant_settings.products_json` — full product list."""
    rows = (
        await db.execute(select(Product).where(Product.merchant_id == merchant_id).order_by(Product.collection_title.asc()))
    ).scalars().all()

    all_products = [
        {
            "product_id": r.id,
            "shopify_product_id": r.shopify_product_id,
            "shopify_product_gid": r.shopify_product_gid,
            "collection_id": r.collection_id,
            "collection_title": r.collection_title,
            "collection_handle": r.collection_handle,
            "collection_products": r.collection_products,
            "shopify_variants": r.shopify_variants,
            "is_tryon_enabled": r.is_tryon_enabled,
        }
        for r in rows
    ]

    settings_row = (await db.execute(select(MerchantSettings).where(MerchantSettings.merchant_id == merchant_id))).scalar_one_or_none()
    if settings_row is not None:
        settings_row.products_json = all_products
        await db.commit()


async def sync_enabled_products_json(db: AsyncSession, merchant_id: int) -> None:
    """Rebuilds `merchant_settings.enabled_products` — backfills handle from
    `collection_products` when the dedicated column is empty."""
    rows = (
        await db.execute(
            select(Product)
            .where(Product.merchant_id == merchant_id, Product.is_tryon_enabled.is_(True))
            .order_by(Product.collection_title.asc())
        )
    ).scalars().all()

    enabled = []
    for r in rows:
        handle = r.handle or ""
        if not handle and r.collection_products:
            pid = str(r.shopify_product_id)
            for cp in r.collection_products:
                if cp.get("handle") and str(cp.get("shopify_product_id")) == pid:
                    handle = str(cp["handle"])
                    break

        enabled.append({
            "product_id": r.id,
            "shopify_product_id": r.shopify_product_id,
            "shopify_product_gid": r.shopify_product_gid,
            "collection_title": r.collection_title,
            "collection_handle": r.collection_handle,
            "handle": handle,
        })

    settings_row = (await db.execute(select(MerchantSettings).where(MerchantSettings.merchant_id == merchant_id))).scalar_one_or_none()
    if settings_row is not None:
        settings_row.enabled_products = enabled
        await db.commit()


async def save_variant_mapping(db: AsyncSession, merchant_id: int, product_id: int, mapping: dict) -> None:
    existing = (
        await db.execute(
            select(VariantImageMapping).where(
                VariantImageMapping.product_id == product_id,
                VariantImageMapping.shopify_variant_id == int(mapping["shopify_variant_id"]),
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        db.add(VariantImageMapping(
            merchant_id=merchant_id,
            product_id=product_id,
            shopify_variant_id=int(mapping["shopify_variant_id"]),
            shopify_variant_gid=mapping["shopify_variant_gid"],
            variant_title=mapping.get("variant_title"),
            tryon_image_url=mapping["tryon_image_url"],
            image_type=mapping.get("image_type", "flat_lay"),
            garment_type=mapping.get("garment_type", "top"),
            avatar_sex=mapping.get("avatar_sex"),
            clothing_prompt=mapping.get("clothing_prompt"),
            is_approved=bool(mapping.get("is_approved", True)),
        ))
    else:
        existing.shopify_variant_gid = mapping["shopify_variant_gid"]
        existing.variant_title = mapping.get("variant_title")
        existing.tryon_image_url = mapping["tryon_image_url"]
        existing.image_type = mapping.get("image_type", "flat_lay")
        existing.garment_type = mapping.get("garment_type", "top")
        existing.avatar_sex = mapping.get("avatar_sex")
        existing.clothing_prompt = mapping.get("clothing_prompt")
        existing.is_approved = bool(mapping.get("is_approved", True))

    await db.commit()


async def get_variant_mappings(db: AsyncSession, product_id: int) -> list[dict]:
    rows = (
        await db.execute(select(VariantImageMapping).where(VariantImageMapping.product_id == product_id).order_by(VariantImageMapping.id.asc()))
    ).scalars().all()
    return [_mapping_to_dict(r) for r in rows]


async def get_mapping_by_variant_id(db: AsyncSession, shopify_variant_id: int) -> dict | None:
    row = (
        await db.execute(select(VariantImageMapping).where(VariantImageMapping.shopify_variant_id == shopify_variant_id))
    ).scalar_one_or_none()
    return _mapping_to_dict(row) if row else None


def _mapping_to_dict(r: VariantImageMapping) -> dict:
    return {
        "id": r.id,
        "merchant_id": r.merchant_id,
        "product_id": r.product_id,
        "shopify_variant_id": r.shopify_variant_id,
        "shopify_variant_gid": r.shopify_variant_gid,
        "variant_title": r.variant_title,
        "tryon_image_url": r.tryon_image_url,
        "image_type": r.image_type,
        "garment_type": r.garment_type,
        "avatar_sex": r.avatar_sex,
        "clothing_prompt": r.clothing_prompt,
        "is_approved": r.is_approved,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


async def find_by_shopify_id(db: AsyncSession, merchant_id: int, shopify_product_id: int) -> Product | None:
    return (
        await db.execute(select(Product).where(Product.merchant_id == merchant_id, Product.shopify_product_id == shopify_product_id))
    ).scalar_one_or_none()


async def list_for_merchant(db: AsyncSession, merchant_id: int) -> list[dict]:
    sql = text("""
        SELECT p.*, COUNT(vim.id) AS variant_mapping_count
        FROM products p
        LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
        WHERE p.merchant_id = :mid
        GROUP BY p.id
        ORDER BY p.collection_title ASC
    """)
    rows = (await db.execute(sql, {"mid": merchant_id})).mappings().all()
    return [row_to_dict(r) for r in rows]


# ── ProductSummaryRepo equivalents ──────────────────────────────────────────


async def get_collections(db: AsyncSession, merchant_id: int) -> list[dict]:
    rows = (await db.execute(select(Collection).where(Collection.merchant_id == merchant_id).order_by(Collection.title.asc()))).scalars().all()
    return [
        {
            "collection_id": r.id,
            "shopify_collection_id": r.shopify_collection_id,
            "shopify_collection_gid": r.shopify_collection_gid,
            "title": r.title,
            "handle": r.handle,
            "products_count": r.products_count,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


async def get_products_summary(db: AsyncSession, merchant_id: int) -> list[dict]:
    sql = text("""
        SELECT
            p.id AS product_id, p.merchant_id, p.shopify_domain, p.shopify_product_id,
            p.shopify_product_gid, p.collection_id, p.collection_title, p.collection_handle,
            p.collection_products, p.shopify_variants, p.is_tryon_enabled, p.created_at, p.updated_at,
            COUNT(vim.id) AS variant_mapping_count
        FROM products p
        LEFT JOIN variant_image_mappings vim ON vim.product_id = p.id
        WHERE p.merchant_id = :mid
        GROUP BY p.id
        ORDER BY p.collection_title ASC
    """)
    rows = (await db.execute(sql, {"mid": merchant_id})).mappings().all()
    return [row_to_dict(r) for r in rows]


async def get_enabled_products_count(db: AsyncSession, merchant_id: int) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(Product).where(Product.merchant_id == merchant_id, Product.is_tryon_enabled.is_(True))
        )
    ).scalar_one()


async def get_variant_mappings_map(db: AsyncSession, merchant_id: int) -> dict:
    rows = (
        await db.execute(select(VariantImageMapping).where(VariantImageMapping.merchant_id == merchant_id).order_by(VariantImageMapping.product_id.asc(), VariantImageMapping.id.asc()))
    ).scalars().all()
    result: dict[str, list[dict]] = {}
    for r in rows:
        result.setdefault(str(r.product_id), []).append(_mapping_to_dict(r))
    return result
