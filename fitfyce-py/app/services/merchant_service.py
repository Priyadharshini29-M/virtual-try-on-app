from __future__ import annotations

import secrets
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import API_KEY_PREFIX, DEFAULT_PLAN
from app.models.merchant import Merchant, MerchantSettings


async def find_merchant_by_domain(db: AsyncSession, domain: str) -> Merchant | None:
    """Port of `MerchantRepo::findByDomain()` + `findByDomainLike()` fallback.
    Does NOT filter on `is_active` — callers decide whether an inactive
    merchant is acceptable (most ?shop= routes reject it via
    `resolve_merchant_by_shop`; `WidgetController::publicGet` deliberately
    serves settings regardless, since storefront theme blocks persist after
    uninstall until the merchant manually removes them).
    """
    result = await db.execute(select(Merchant).where(Merchant.shopify_domain == domain))
    merchant = result.scalar_one_or_none()

    if merchant is None:
        fuzzy = await db.execute(select(Merchant).where(Merchant.shopify_domain.ilike(f"%{domain}%")))
        merchant = fuzzy.scalars().first()

    return merchant


async def create_merchant(db: AsyncSession, domain: str, store_id: str, access_token: str) -> Merchant:
    """Port of `MerchantController::register()`'s new-merchant branch —
    generates api_key='tf_'+48 hex chars (24 random bytes) + api_secret,
    creates the merchant, and seeds an empty merchant_settings row."""
    api_key = API_KEY_PREFIX + secrets.token_hex(24)
    api_secret = secrets.token_hex(32)

    merchant = Merchant(
        shopify_domain=domain,
        shopify_store_id=store_id,
        access_token=access_token,
        plan=DEFAULT_PLAN,
        api_key=api_key,
        api_secret=api_secret,
        tryon_count_month=0,
        billing_cycle_start=date.today(),
        is_active=True,
    )
    db.add(merchant)
    await db.flush()

    existing_settings = (
        await db.execute(select(MerchantSettings).where(MerchantSettings.merchant_id == merchant.id))
    ).scalar_one_or_none()
    if existing_settings is None:
        db.add(MerchantSettings(merchant_id=merchant.id, shopify_domain=domain, shopify_store_id=store_id))

    await db.commit()
    await db.refresh(merchant)
    return merchant
