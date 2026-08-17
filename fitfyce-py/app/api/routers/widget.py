"""Port of WidgetController.php.

Phase 1 scope: `GET /api/widget-settings` only (public, no auth — matches
`router.php`'s `GET /api/widget-settings -> WidgetController::publicGet`,
which has no ApiKeyAuth). The authenticated `GET/PATCH /widget/settings`
routes belong to a later phase (they need `require_api_key`, already built,
but are grouped with the rest of the merchant-dashboard routes per the
phased rollout plan).
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Identity, require_api_key
from app.db.session import get_db
from app.services.merchant_service import find_merchant_by_domain
from app.services.settings_service import (
    flat_widget_config,
    format_config,
    get_or_create_settings_row,
    patch_widget_config,
    sanitize_widget_fields,
)

router = APIRouter()

# Free/basic plan merchants always show the watermark regardless of their
# saved setting — matches WidgetController::publicGet()'s $freePlans check.
_FREE_PLANS = {"", "free", "basic"}


@router.get("/api/widget-settings")
async def public_get_widget_settings(
    response: Response,
    shop: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"

    shop = shop.strip()
    if shop == "":
        return {}

    # Normalise: strip protocol prefix and trailing slash (some themes/
    # proxies inject "https://store.myshopify.com/").
    shop = re.sub(r"^https?://", "", shop, flags=re.IGNORECASE).rstrip("/")

    merchant = await find_merchant_by_domain(db, shop)
    if merchant is None:
        return {}

    # Serve settings regardless of is_active — widget blocks remain in
    # themes even after uninstall until the merchant manually removes them.
    settings_row = await get_or_create_settings_row(db, merchant)

    flat = flat_widget_config(settings_row.widget_config or {})

    plan = (merchant.plan or "").strip().lower()
    if plan in _FREE_PLANS:
        flat["show_watermark"] = True

    # Only include enabled-product lists when the data is actually
    # populated. Omitting the keys causes the widget JS to fall back to
    # "show icon on all cards" (correct before any product sync has run);
    # sending an empty list would incorrectly hide all collection icons.
    enabled_products = settings_row.enabled_products
    if enabled_products is not None:
        all_products = settings_row.products_json or []
        handle_map: dict[str, str] = {}
        for p in all_products:
            pid = str(p.get("shopify_product_id", ""))
            if not pid:
                continue
            h = str(p.get("handle") or "")
            if h:
                handle_map[pid] = h
                continue
            for cp in p.get("collection_products") or []:
                if cp.get("handle") and str(cp.get("shopify_product_id")) == pid:
                    handle_map[pid] = str(cp["handle"])
                    break

        flat["enabled_product_ids"] = [str(p.get("shopify_product_id", "")) for p in enabled_products]
        handles: list[str] = []
        for p in enabled_products:
            pid = str(p.get("shopify_product_id", ""))
            h = str(p.get("handle") or "") or handle_map.get(pid, "")
            if h:
                handles.append(h)
        flat["enabled_product_handles"] = handles

    return flat


@router.get("/widget/settings")
async def get_widget_settings(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if identity.merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    settings_row = await get_or_create_settings_row(db, identity.merchant)

    return JSONResponse({
        "shop_id": identity.id,
        "button_config": format_config(settings_row.widget_config or {}),
        "products": settings_row.products_json or [],
        "enabled_products": settings_row.enabled_products,
    })


@router.patch("/widget/settings")
async def patch_widget_settings(
    identity: Identity = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
    body: dict = Body(...),
) -> JSONResponse:
    if identity.merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    fields = sanitize_widget_fields(body)
    if not fields:
        return JSONResponse({"error": "No valid fields provided"}, status_code=400)

    row = await patch_widget_config(db, identity.merchant, fields)

    return JSONResponse({
        "shop_id": identity.id,
        "button_config": format_config(row.widget_config or {}),
    })
