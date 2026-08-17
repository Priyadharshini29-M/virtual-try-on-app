"""Shared FastAPI dependencies — the 3 real auth patterns from the PHP
backend (see ApiKeyAuth.php / TryOnController.php's ?shop= pattern /
MerchantController::deactivate's HMAC check), plus the shop-domain
resolution helper.

Deliberately NOT unified into one "auth" dependency: each PHP route had its
own specific not-found behavior (some 404, `widget-settings` silently
returns `{}`), so routers call these primitives and decide their own
response for the "not found" case rather than this module deciding for them.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.merchant import Merchant
from app.services.merchant_service import find_merchant_by_domain


@dataclass
class Identity:
    """Result of `require_api_key`. `is_master` mirrors PHP's merchant
    id===0 sentinel: a synthetic superuser identity granted when the caller
    presents MASTER_API_KEY, with NO database lookup — used by
    webhook-originated / cross-merchant calls (Conversion, Product,
    Merchant register/by-domain).
    """

    is_master: bool
    merchant: Merchant | None

    @property
    def id(self) -> int:
        return 0 if self.is_master else self.merchant.id  # type: ignore[union-attr]

    @property
    def plan(self) -> str:
        return "master" if self.is_master else self.merchant.plan  # type: ignore[union-attr]


async def require_api_key(
    x_api_key: str = Header(default="", alias="X-Api-Key"),
    db: AsyncSession = Depends(get_db),
) -> Identity:
    """Port of `ApiKeyAuth::handle()`."""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")

    settings = get_settings()
    if settings.master_api_key and x_api_key == settings.master_api_key:
        return Identity(is_master=True, merchant=None)

    result = await db.execute(select(Merchant).where(Merchant.api_key == x_api_key))
    merchant = result.scalar_one_or_none()
    if merchant is None or not merchant.is_active:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return Identity(is_master=False, merchant=merchant)


def _normalize_domain(domain: str) -> str:
    domain = domain.strip().lower()
    domain = re.sub(r"^https?://", "", domain)
    return domain.rstrip("/")


async def get_shop_domain(
    shop: str | None = Query(default=None),
    x_shop_domain: str | None = Header(default=None, alias="X-Shop-Domain"),
) -> str | None:
    """Remix sends the shop domain redundantly three ways (resolved API
    key's own merchant, `X-Shop-Domain` header, `?shop=` query param) — this
    accepts it from either of the latter two carriers so callers don't have
    to care which one a given request actually used.
    """
    domain = shop or x_shop_domain
    return _normalize_domain(domain) if domain else None


async def resolve_merchant_by_shop(
    shop_domain: str | None = Depends(get_shop_domain),
    db: AsyncSession = Depends(get_db),
) -> Merchant | None:
    """Port of the `?shop=` → `MerchantRepo::findByDomain`/`findByDomainLike`
    pattern used by TryOnController, StudioV2Controller, InfographicController,
    GarmentStudioController, and SessionController's auth fallback.

    Returns `None` on no-match/inactive rather than raising — each router
    decides its own not-found response, matching PHP's per-route behavior.
    Note: unlike this dependency, `WidgetController.publicGet`'s Python port
    must NOT filter on `is_active` (PHP serves settings to inactive
    merchants deliberately) — it calls `find_merchant_by_domain()` directly
    instead of using this dependency.
    """
    if not shop_domain:
        return None

    merchant = await find_merchant_by_domain(db, shop_domain)
    if merchant is None or not merchant.is_active:
        return None
    return merchant


async def verify_shopify_hmac(request: Request) -> bytes:
    """Port of the HMAC verification in `MerchantController::deactivate()`.
    Returns the raw request body (signature is computed over exact bytes,
    so route handlers must parse this themselves rather than declaring a
    Pydantic body model, which would consume/re-encode the stream first).
    """
    settings = get_settings()
    raw_body = await request.body()
    signature = request.headers.get("X-Shopify-Hmac-Sha256", "")

    if not signature or not settings.shopify_api_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    computed = base64.b64encode(
        hmac.new(settings.shopify_api_secret.encode(), raw_body, hashlib.sha256).digest()
    ).decode()

    if not hmac.compare_digest(computed, signature):
        raise HTTPException(status_code=401, detail="Unauthorized")

    return raw_body
