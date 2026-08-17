"""Port of StudioV2Controller.php — /studio-v2/* routes.

Note: `GET /studio-v2/generation` (get_generation) has NO auth in the
original PHP (confirmed by reading StudioV2Controller.php — it only checks
`generation_id` is non-empty, a real cross-merchant data-leak bug). This
port deliberately ADDS merchant auth + an ownership check here — a
documented behavior fix, not a faithful port. See openai_client.py's
MARKETING_STYLE_KEYS docstring for the other documented gap in this
controller (marketingStyleKeys()/generateMarketingInfographics() never
existed in PHP at all).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_merchant_by_shop
from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_db
from app.integrations.fashn_client import FashnClient
from app.models.merchant import Merchant
from app.services import image_service, storage_service
from app.services import studio_v2_service as sv2
from app.utils.urls import base_path, base_url

router = APIRouter()
logger = get_logger(__name__)


# ── Saved Models ─────────────────────────────────────────────────────────

@router.post("/studio-v2/models")
async def upload_saved_model(
    request: Request,
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    image_url = str(payload.get("image_url") or "").strip()
    if image_url == "":
        return JSONResponse({"error": "image_url is required"}, status_code=400)

    persisted = await sv2.persist_permanent_image(request, image_url, storage_service.library_dir(), "model")
    if persisted is None:
        return JSONResponse({"error": "Failed to save model image"}, status_code=500)
    dest_url, dest_path = persisted

    model = await sv2.create_saved_model(db, merchant.id, dest_url)
    thumb_url = sv2.make_and_save_thumbnail(request, dest_path, storage_service.library_dir(), "model")
    await sv2.record_asset(db, merchant.id, dest_url, thumb_url, "saved_model", str(model.id))

    return JSONResponse({"ok": True, "id": str(model.id), "image_url": dest_url, "created_at": model.created_at.isoformat()})


@router.get("/studio-v2/models")
async def list_saved_models(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    models = await sv2.list_saved_models(db, merchant.id)
    return JSONResponse({"models": [sv2.saved_model_to_dict(m) for m in models]})


@router.delete("/studio-v2/models")
async def delete_saved_model(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    model_id = str(payload.get("saved_model_id") or "").strip()
    if model_id == "":
        return JSONResponse({"error": "saved_model_id is required"}, status_code=400)

    model = await sv2.find_saved_model(db, model_id)
    if model is None or model.merchant_id != merchant.id:
        return JSONResponse({"error": "Saved model not found"}, status_code=404)

    sv2.unlink_local_asset(model.image_url)
    await sv2.delete_saved_model(db, model_id, merchant.id)
    await sv2.delete_assets_by_source(db, "saved_model", model_id)

    return JSONResponse({"ok": True, "id": model_id})


# ── Generation pipeline ──────────────────────────────────────────────────

@router.post("/studio-v2/generate")
async def generate(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    product_image_url = str(payload.get("product_image_url") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    saved_model_id = str(payload.get("saved_model_id") or "").strip()
    model_image_url = str(payload.get("model_image_url") or "").strip()
    garment_type = str(payload.get("garment_type") or "").strip()

    if product_image_url == "":
        return JSONResponse({"error": "product_image_url is required"}, status_code=400)
    if len(prompt) < 10 or len(prompt) > 500:
        return JSONResponse({"error": "prompt must be between 10 and 500 characters"}, status_code=400)

    resolved_model_url: str | None = None
    resolved_saved_model_id: str | None = None
    if saved_model_id != "":
        saved_model = await sv2.find_saved_model(db, saved_model_id)
        if saved_model is None or saved_model.merchant_id != merchant.id:
            return JSONResponse({"error": "saved_model_id not found"}, status_code=404)
        resolved_model_url = saved_model.image_url
        resolved_saved_model_id = saved_model_id
    elif model_image_url != "":
        resolved_model_url = model_image_url
    else:
        return JSONResponse({"error": "Either saved_model_id or model_image_url is required"}, status_code=400)

    settings = get_settings()
    if not settings.fashn_api_key:
        return JSONResponse({"error": "Try-on service is not configured. Add FASHN_API_KEY to .env."}, status_code=503)

    generation = await sv2.create_generation(db, {
        "merchant_id": merchant.id,
        "product_id": int(payload["product_id"]) if payload.get("product_id") is not None else None,
        "shopify_variant_id": int(payload["shopify_variant_id"]) if payload.get("shopify_variant_id") is not None else None,
        "product_image_url": product_image_url,
        "saved_model_id": resolved_saved_model_id,
        "model_image_url": resolved_model_url,
        "prompt": prompt,
    })
    generation_id = str(generation.id)
    await sv2.update_generation_status(db, generation_id, "processing", api_request_at=datetime.utcnow())

    try:
        product_bytes = await image_service.fetch_image_bytes(product_image_url)
        model_bytes = await image_service.fetch_image_bytes(resolved_model_url)
        if product_bytes is None or model_bytes is None:
            raise RuntimeError("Failed to load product or model image")

        product_bytes = image_service.reencode_as_jpeg(product_bytes)
        product_bytes = image_service.ensure_minimum_size_bytes(product_bytes, 768, 1024)

        model_bytes = image_service.reencode_as_jpeg(model_bytes)
        model_bytes = image_service.ensure_minimum_size_bytes(model_bytes, 768, 1024)

        fashn_client = FashnClient(settings.fashn_api_key, mode="quality")
        result = await fashn_client.submit_run(
            model_image=image_service.bytes_to_base64_uri(model_bytes),
            garment_image=image_service.bytes_to_base64_uri(product_bytes),
            category=sv2.resolve_category(garment_type, prompt),
            garment_photo_type="auto",
            seed=-1,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("StudioV2 generation exception: %s", exc)
        await sv2.update_generation_status(db, generation_id, "failed", error_message=str(exc))
        return JSONResponse({"error": f"Generation failed: {exc}", "generation_id": generation_id}, status_code=500)

    if result["status_code"] != 200 or not result.get("prediction_id"):
        raw_error = result.get("error_details") or "Try-on API request failed"
        await sv2.update_generation_status(db, generation_id, "failed", error_message=raw_error)
        return JSONResponse({"error": raw_error, "generation_id": generation_id}, status_code=400)

    await sv2.update_generation_status(db, generation_id, "processing", fashn_prediction_id=result["prediction_id"])

    return JSONResponse({"generation_id": generation_id, "status": "processing"})


@router.get("/studio-v2/generate-status")
async def check_generation_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    generation_id: str = Query(default=""),
) -> JSONResponse:
    generation_id = generation_id.strip()
    if generation_id == "":
        return JSONResponse({"error": "generation_id is required"}, status_code=400)

    row = await sv2.find_generation(db, generation_id)
    if row is None:
        return JSONResponse({"error": "Generation not found"}, status_code=404)

    if row.status == "completed":
        infographics = [sv2.infographic_to_dict(r) for r in await sv2.list_infographics_by_generation(db, generation_id)]
        return JSONResponse({
            "status": "completed", "generation_id": generation_id,
            "result_image": row.result_image_url, "infographics": infographics,
        })
    if row.status == "failed":
        return JSONResponse({"status": "failed", "generation_id": generation_id, "error": row.error_message})

    prediction_id = (row.fashn_prediction_id or "").strip()
    if prediction_id == "":
        return JSONResponse({"status": "processing", "generation_id": generation_id})

    requested_at = row.api_request_at
    if requested_at is not None and (datetime.utcnow() - requested_at) > timedelta(seconds=180):
        await sv2.update_generation_status(db, generation_id, "failed", error_message="Generation timed out. Please try again.")
        return JSONResponse({"status": "failed", "generation_id": generation_id, "error": "Generation timed out. Please try again."})

    settings = get_settings()
    fashn_client = FashnClient(settings.fashn_api_key)
    check = await fashn_client.check_status(prediction_id)

    if check["job_status"] in ("processing", "error"):
        return JSONResponse({"status": "processing", "generation_id": generation_id})

    if check["job_status"] == "failed":
        raw_error = check.get("error_details") or "Try-on API request failed"
        await sv2.update_generation_status(db, generation_id, "failed", error_message=raw_error, api_response_at=datetime.utcnow())
        return JSONResponse({"status": "failed", "generation_id": generation_id, "error": raw_error})

    # FASHN completed — save the dressed-model result, then chain OpenAI.
    generations_dir = storage_service.generations_dir()
    filename = f"model_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}.jpg"
    out_path = generations_dir / filename
    out_path.write_bytes(check["image_bytes"])

    result_url = f"{base_url(request)}{base_path(request)}/generations/{filename}"
    merchant_id = row.merchant_id
    latency_ms = int((datetime.utcnow() - requested_at).total_seconds() * 1000) if requested_at else None

    await sv2.update_generation_status(
        db, generation_id, "completed",
        result_image_url=result_url, api_response_at=datetime.utcnow(), api_latency_ms=latency_ms,
    )

    model_thumb_url = sv2.make_and_save_thumbnail(request, out_path, generations_dir, "model")
    await sv2.record_asset(db, merchant_id, result_url, model_thumb_url, "generation", generation_id)

    infographics = await sv2.run_infographic_batch(request, db, generation_id, merchant_id, check["image_bytes"], row.prompt)

    return JSONResponse({
        "status": "completed", "generation_id": generation_id,
        "result_image": result_url, "infographics": infographics,
    })


@router.post("/studio-v2/regenerate-infographics")
async def regenerate_infographics(
    request: Request,
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    generation_id = str(payload.get("generation_id") or "").strip()
    if generation_id == "":
        return JSONResponse({"error": "generation_id is required"}, status_code=400)

    row = await sv2.find_generation(db, generation_id)
    if row is None or row.merchant_id != merchant.id:
        return JSONResponse({"error": "Generation not found"}, status_code=404)
    if row.status != "completed" or not row.result_image_url:
        return JSONResponse({"error": "Generation has no result image to regenerate creatives from"}, status_code=400)

    result_bytes = await image_service.fetch_image_bytes(row.result_image_url)
    if result_bytes is None:
        return JSONResponse({"error": "Could not load the generated model image"}, status_code=500)

    # Remove the old creatives (files + rows + assets) before regenerating.
    old_rows = await sv2.delete_infographics_by_generation(db, generation_id)
    for old in old_rows:
        if old.image_url:
            sv2.unlink_local_asset(old.image_url)
        await sv2.delete_assets_by_source(db, "infographic", str(old.id))

    infographics = await sv2.run_infographic_batch(request, db, generation_id, merchant.id, result_bytes, row.prompt)

    return JSONResponse({"ok": True, "generation_id": generation_id, "infographics": infographics})


@router.delete("/studio-v2/generation")
async def delete_generation(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    generation_id = str(payload.get("generation_id") or "").strip()
    if generation_id == "":
        return JSONResponse({"error": "generation_id is required"}, status_code=400)

    row = await sv2.find_generation(db, generation_id)
    if row is None or row.merchant_id != merchant.id:
        return JSONResponse({"error": "Generation not found"}, status_code=404)

    info_rows = await sv2.delete_infographics_by_generation(db, generation_id)
    for info in info_rows:
        if info.image_url:
            sv2.unlink_local_asset(info.image_url)
        await sv2.delete_assets_by_source(db, "infographic", str(info.id))

    if row.result_image_url:
        sv2.unlink_local_asset(row.result_image_url)
    await sv2.delete_assets_by_source(db, "generation", generation_id)
    await sv2.delete_generation(db, generation_id, merchant.id)

    return JSONResponse({"ok": True, "generation_id": generation_id})


@router.get("/studio-v2/generations")
async def list_generations(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    limit = min(50, max(1, limit))
    offset = max(0, offset)
    rows = await sv2.list_generations(db, merchant.id, limit, offset)

    generations = []
    for row in rows:
        infographics = (
            [sv2.infographic_to_dict(r) for r in await sv2.list_infographics_by_generation(db, str(row.id))]
            if row.status == "completed" else []
        )
        generations.append(sv2.generation_to_dict(row, infographics))

    return JSONResponse({"generations": generations})


@router.get("/studio-v2/generation")
async def get_generation(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    generation_id: str = Query(default=""),
) -> JSONResponse:
    # PHP's getGeneration() has NO auth at all — a cross-merchant data-leak
    # bug. Deliberately fixed here: require the same ?shop= auth as every
    # other StudioV2 route, plus an ownership check on the row.
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    generation_id = generation_id.strip()
    if generation_id == "":
        return JSONResponse({"error": "generation_id is required"}, status_code=400)

    row = await sv2.find_generation(db, generation_id)
    if row is None or row.merchant_id != merchant.id:
        return JSONResponse({"error": "Generation not found"}, status_code=404)

    infographics = [sv2.infographic_to_dict(r) for r in await sv2.list_infographics_by_generation(db, generation_id)]
    return JSONResponse(sv2.generation_to_dict(row, infographics))


# ── Asset Library ─────────────────────────────────────────────────────────

@router.get("/studio-v2/assets")
async def list_assets(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    limit = min(200, max(1, limit))
    offset = max(0, offset)
    assets = await sv2.list_assets(db, merchant.id, limit, offset)
    return JSONResponse({"assets": [sv2.asset_to_dict(a) for a in assets]})
