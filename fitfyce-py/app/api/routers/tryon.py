"""Port of TryOnController.php."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_db
from app.integrations.tryon_diffusion_client import TryOnDiffusionClient
from app.services import analytics_service, image_service, plan_limit_service, product_service, session_service, storage_service
from app.services.merchant_service import find_merchant_by_domain
from app.utils.urls import base_path, base_url

router = APIRouter()
logger = get_logger(__name__)


@router.post("/tryon")
@router.post("/api/tryon")
async def handle_tryon(
    request: Request,
    db: AsyncSession = Depends(get_db),
    shop: str = Query(default=""),
    body: dict = Body(...),
) -> JSONResponse:
    shop = shop.strip()
    if shop == "":
        return JSONResponse({"error": "shop parameter is required"}, status_code=400)

    merchant = await find_merchant_by_domain(db, shop)
    if merchant is None or not merchant.is_active:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    # Auto-reset monthly count when the 30-day billing window has elapsed
    if merchant.billing_cycle_start is not None and merchant.billing_cycle_start + timedelta(days=30) <= date.today():
        merchant.tryon_count_month = 0
        merchant.billing_cycle_start = date.today()
        await db.commit()

    limit_error = await plan_limit_service.check_plan_limit(db, merchant)
    if limit_error is not None:
        return JSONResponse(limit_error, status_code=429)

    clothing_input = str(body.get("clothing_image", "")).strip()
    avatar_input = str(body.get("avatar_image", "")).strip()
    variant_id = int(body["shopify_variant_id"]) if body.get("shopify_variant_id") is not None else None

    mapping = None
    if variant_id is not None:
        mapping = await product_service.get_mapping_by_variant_id(db, variant_id)

    if mapping:
        if mapping.get("tryon_image_url"):
            clothing_input = mapping["tryon_image_url"]
        if mapping.get("clothing_prompt"):
            body["clothing_prompt"] = mapping["clothing_prompt"]
        if mapping.get("avatar_sex"):
            body["avatar_sex"] = mapping["avatar_sex"]

    if clothing_input == "" or avatar_input == "":
        return JSONResponse({"error": "clothing_image and avatar_image are required"}, status_code=400)

    settings = get_settings()
    if not settings.vton_api_key or not settings.vton_api_url:
        return JSONResponse(
            {"error": "Try-on service is not configured. Add TRY_ON_DIFFUSION_DEMO_API_KEY / TRY_ON_DIFFUSION_DEMO_API_URL."},
            status_code=503,
        )

    seed = int(body.get("seed", -1))
    avatar_sex = body.get("avatar_sex") if body.get("avatar_sex") in ("male", "female") else (mapping.get("avatar_sex") if mapping else None)
    clothing_prompt_text = str(mapping.get("clothing_prompt") or body.get("clothing_prompt") or "") if mapping else str(body.get("clothing_prompt", ""))

    clothing_bytes = await image_service.fetch_image_bytes(clothing_input)
    if clothing_bytes is None:
        return JSONResponse({"error": "Failed to load clothing_image"}, status_code=400)

    avatar_bytes = await image_service.fetch_image_bytes(avatar_input)
    if avatar_bytes is None:
        return JSONResponse({"error": "Failed to load avatar_image"}, status_code=400)

    client = TryOnDiffusionClient(settings.vton_api_url, settings.vton_api_key)
    result = await client.try_on_file(
        clothing_image_bytes=clothing_bytes,
        avatar_image_bytes=avatar_bytes,
        clothing_prompt=clothing_prompt_text or None,
        avatar_sex=avatar_sex,
        seed=seed,
    )

    session_id = body.get("session_id")

    if result.status_code != 200 or result.image_bytes is None:
        raw_error = result.error_details or "Try-on API request failed"
        logger.warning("Try-on API failed: status=%s error=%s shop=%s", result.status_code, raw_error, shop)

        if result.status_code == 429:
            user_error = "Service temporarily unavailable. Please try again later."
        elif result.status_code == 400 and raw_error and "image_too_small" in raw_error:
            user_error = "Try-on failed. Please try again."
        elif result.status_code == 400 and raw_error and "File size exceeds" in raw_error:
            user_error = "Image file is too large. Please use a smaller photo and try again."
        elif result.status_code == 0:
            user_error = "Try-on request timed out. Please try again."
        elif result.status_code in (401, 403):
            user_error = "Try-on service configuration error. Please contact support."
        else:
            user_error = "Try-on failed. Please try again."

        if session_id:
            await session_service.update_status(db, str(session_id), "failed", error_message=raw_error)
        await analytics_service.upsert_daily(db, merchant.id, date.today(), {"tryon_failed": 1})

        return JSONResponse(
            {"error": user_error, "status_code": result.status_code, "raw_error": raw_error},
            status_code=503 if result.status_code == 429 else 400,
        )

    import uuid as uuid_mod
    filename = f"tryon_result_{date.today().strftime('%Y%m%d')}_{uuid_mod.uuid4().hex[:6]}.jpg"
    (storage_service.results_dir() / filename).write_bytes(result.image_bytes)
    url = f"{base_url(request)}{base_path(request)}/results/{filename}"

    if session_id:
        await session_service.update_status(
            db, str(session_id), "completed",
            result_image_url=url, result_seed=result.seed,
        )

    merchant.tryon_count_month = merchant.tryon_count_month + 1
    await db.commit()

    await analytics_service.upsert_daily(db, merchant.id, date.today(), {"tryon_completed": 1})

    return JSONResponse({"result_image": url, "seed": result.seed})
