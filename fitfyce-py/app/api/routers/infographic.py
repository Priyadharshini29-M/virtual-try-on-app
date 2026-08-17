"""Port of InfographicController.php — /infographic/* routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_db
from app.integrations.openai_client import OpenAIClient
from app.services import image_service, infographic_service as infog
from app.services.merchant_service import find_merchant_by_domain

router = APIRouter()
logger = get_logger(__name__)


async def _require_openai() -> OpenAIClient | JSONResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        return JSONResponse({"error": "OpenAI API key is not configured."}, status_code=503)
    return OpenAIClient(settings.openai_api_key)


async def _auth_merchant(db: AsyncSession, shop: str) -> JSONResponse | None:
    shop = shop.strip()
    if shop == "":
        return JSONResponse({"error": "shop parameter is required"}, status_code=400)
    merchant = await find_merchant_by_domain(db, shop)
    if merchant is None or not merchant.is_active:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return None


@router.post("/infographic/create")
async def create(
    request: Request,
    db: AsyncSession = Depends(get_db),
    shop: str = Query(default=""),
    payload: dict = Body(...),
) -> JSONResponse:
    openai = await _require_openai()
    if isinstance(openai, JSONResponse):
        return openai
    auth_error = await _auth_merchant(db, shop)
    if auth_error is not None:
        return auth_error

    try:
        description = str(payload.get("description") or "").strip()
        image_url = str(payload.get("product_image_url") or "").strip()
        style = infog.resolve_style(str(payload.get("style") or ""))
        custom_style = str(payload.get("custom_style_prompt") or "").strip()
        category = infog.resolve_category(str(payload.get("product_category") or ""))
        size = infog.resolve_size(str(payload.get("size") or ""))

        if description == "":
            return JSONResponse({"error": "description is required"}, status_code=400)
        if image_url == "":
            return JSONResponse({"error": "product_image_url is required"}, status_code=400)

        key_points = await openai.extract_key_points(description)
        if not key_points:
            return JSONResponse({"error": "Could not extract key points — try rephrasing the description."}, status_code=422)

        if style == "collage":
            results = await infog.compose_and_save_collage(request, openai, image_url, key_points, description, custom_style, size)
            return JSONResponse({"results": results, "key_points": key_points})

        result_url = await infog.compose_and_save(request, openai, image_url, key_points, style, description, custom_style, category, 1, size)
        return JSONResponse({"results": infog.to_results(result_url, style, 1), "key_points": key_points})
    except Exception as exc:  # noqa: BLE001
        logger.error("Infographic create failed: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/infographic/extract-points")
async def extract_points(
    db: AsyncSession = Depends(get_db),
    shop: str = Query(default=""),
    payload: dict = Body(...),
) -> JSONResponse:
    openai = await _require_openai()
    if isinstance(openai, JSONResponse):
        return openai
    auth_error = await _auth_merchant(db, shop)
    if auth_error is not None:
        return auth_error

    try:
        description = str(payload.get("description") or "").strip()
        if description == "":
            return JSONResponse({"error": "description is required"}, status_code=400)

        key_points = await openai.extract_key_points(description)
        if not key_points:
            return JSONResponse({"error": "Could not extract key points — try rephrasing the description."}, status_code=422)
        return JSONResponse({"key_points": key_points})
    except Exception as exc:  # noqa: BLE001
        logger.error("Infographic extract failed: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/infographic/generate")
async def generate(
    request: Request,
    db: AsyncSession = Depends(get_db),
    shop: str = Query(default=""),
    payload: dict = Body(...),
) -> JSONResponse:
    auth_error = await _auth_merchant(db, shop)
    if auth_error is not None:
        return auth_error
    openai = await _require_openai()
    if isinstance(openai, JSONResponse):
        return openai

    try:
        image_url = str(payload.get("product_image_url") or "").strip()
        description = str(payload.get("description") or "").strip()
        custom_style = str(payload.get("custom_style_prompt") or "").strip()
        category = infog.resolve_category(str(payload.get("product_category") or ""))
        variation = max(1, min(5, int(payload.get("variation") or 1)))
        size = infog.resolve_size(str(payload.get("size") or ""))
        key_points = [
            p.strip() for p in (payload.get("key_points") or [])
            if isinstance(p, str) and p.strip() != ""
        ]
        style = infog.resolve_style(str(payload.get("style") or ""))

        if image_url == "":
            return JSONResponse({"error": "product_image_url is required"}, status_code=400)
        if not key_points:
            return JSONResponse({"error": "key_points array is required"}, status_code=400)

        if style == "collage":
            results = await infog.compose_and_save_collage(request, openai, image_url, key_points, description, custom_style, size)
            return JSONResponse({"results": results, "key_points": key_points})

        result_url = await infog.compose_and_save(request, openai, image_url, key_points, style, description, custom_style, category, variation, size)
        return JSONResponse({"results": infog.to_results(result_url, style, variation), "key_points": key_points})
    except Exception as exc:  # noqa: BLE001
        logger.error("Infographic generate failed: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/infographic/edit")
async def edit(
    request: Request,
    db: AsyncSession = Depends(get_db),
    shop: str = Query(default=""),
    payload: dict = Body(...),
) -> JSONResponse:
    openai = await _require_openai()
    if isinstance(openai, JSONResponse):
        return openai
    auth_error = await _auth_merchant(db, shop)
    if auth_error is not None:
        return auth_error

    try:
        image_url = str(payload.get("image_url") or "").strip()
        edit_prompt = str(payload.get("edit_prompt") or "").strip()
        bg_image_url = str(payload.get("background_image_url") or "").strip()

        if image_url == "":
            return JSONResponse({"error": "image_url is required"}, status_code=400)
        if edit_prompt == "":
            return JSONResponse({"error": "edit_prompt is required"}, status_code=400)

        image_bytes = await image_service.fetch_image_bytes(image_url)
        if image_bytes is None:
            return JSONResponse({"error": "Could not load the image to edit. Check the URL and try again."}, status_code=400)

        bg_bytes = None
        if bg_image_url != "":
            bg_bytes = await image_service.fetch_image_bytes(bg_image_url)
            if bg_bytes is None:
                return JSONResponse({"error": "Could not load the background image. Check the URL and try again."}, status_code=400)

        result_bytes = await openai.edit_infographic_image(image_bytes, "infographic.png", edit_prompt, bg_bytes, "background.jpg")
        result_url = infog.save_generated(request, result_bytes)
        return JSONResponse({"results": infog.to_results(result_url, "edited", 1)})
    except Exception as exc:  # noqa: BLE001
        logger.error("Infographic edit failed: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=500)
