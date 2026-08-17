"""Port of GarmentStudioController.php — /studio/* routes."""

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
from app.services import garment_studio_service as gs
from app.services import image_service, storage_service
from app.utils.urls import base_path, base_url

router = APIRouter()
logger = get_logger(__name__)


@router.post("/studio/generate")
async def generate(
    request: Request,
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    front_url = str(payload.get("front_image_url") or "").strip()
    back_url = str(payload.get("back_image_url") or "").strip()
    model_key = str(payload.get("model_key") or "").strip()

    if front_url == "":
        return JSONResponse({"error": "front_image_url is required"}, status_code=400)
    if model_key not in gs.MODELS:
        return JSONResponse({"error": "Invalid model_key", "valid_keys": list(gs.MODELS.keys())}, status_code=400)

    model_info = gs.MODELS[model_key]
    gender = model_info["gender"]
    detail1 = str(payload.get("detail_image_1_url") or "").strip() or None
    detail2 = str(payload.get("detail_image_2_url") or "").strip() or None
    detail3 = str(payload.get("detail_image_3_url") or "").strip() or None
    garment_type = gs.resolve_garment_type(payload)
    custom_prompt = str(payload.get("clothing_prompt") or "").strip()

    workflow_type = str(payload.get("workflow_type") or "").strip()
    garment_photo_type = "flat-lay" if workflow_type == "flat-lay" else "auto"

    settings = get_settings()
    use_flatlay_conversion = (
        garment_type == "full" and workflow_type == "flat-lay" and bool(settings.fal_api_key)
    )
    flatlay_hint = gs.infer_flatlay_garment_hint(custom_prompt)

    fashn_model = str(payload.get("fashn_model") or "").strip()
    if fashn_model not in ("tryon-v1.6", "tryon-max", "product-to-model"):
        fashn_model = "tryon-v1.6"

    model_image_path = gs.resolve_model_image_path(model_key, gender)
    if model_image_path is None:
        expected_path = str(storage_service.models_dir() / gender / f"{model_key}.jpg")
        return JSONResponse(
            {
                "error": f"Model image for '{model_key}' not found. Upload a JPEG to: {expected_path}",
                "model_key": model_key,
                "model_label": model_info["label"],
                "expected_path": expected_path,
            },
            status_code=422,
        )

    session_id = await gs.create_session(db, {
        "merchant_id": merchant.id,
        "product_id": int(payload["product_id"]) if payload.get("product_id") is not None else None,
        "shopify_variant_id": int(payload["shopify_variant_id"]) if payload.get("shopify_variant_id") is not None else None,
        "front_image_url": front_url,
        "back_image_url": back_url,
        "detail_image_1_url": detail1,
        "detail_image_2_url": detail2,
        "detail_image_3_url": detail3,
        "gender": gender,
        "model_key": model_key,
        "garment_type": garment_type,
        "clothing_prompt": custom_prompt or None,
    })
    await gs.update_status(db, str(session_id), "processing", api_request_at=datetime.utcnow())

    try:
        result = await gs.prepare_and_submit(
            front_url=front_url,
            back_url=back_url,
            detail1=detail1,
            detail2=detail2,
            detail3=detail3,
            model_image_path=model_image_path,
            garment_type=garment_type,
            garment_photo_type=garment_photo_type,
            use_flatlay_conversion=use_flatlay_conversion,
            flatlay_hint=flatlay_hint,
            fashn_model=fashn_model,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("GarmentStudio generation exception: %s", exc)
        await gs.update_status(db, str(session_id), "failed", error_message=str(exc))
        return JSONResponse({"error": f"Generation failed: {exc}", "session_id": str(session_id)}, status_code=500)

    if result["status_code"] != 200 or not result.get("prediction_id"):
        raw_error = result.get("error_details") or "Try-on API request failed"
        logger.warning(
            "GarmentStudio submission failure: status=%s error=%s model_key=%s",
            result["status_code"], raw_error, model_key,
        )
        await gs.update_status(db, str(session_id), "failed", error_message=raw_error)
        http_status = 503 if result["status_code"] in (429, 503) else 400
        return JSONResponse(
            {
                "error": gs.user_friendly_error(result["status_code"], raw_error),
                "session_id": str(session_id),
                "raw_error": raw_error,
            },
            status_code=http_status,
        )

    await gs.update_status(db, str(session_id), "processing", fashn_prediction_id=result["prediction_id"])

    return JSONResponse({
        "session_id": str(session_id),
        "status": "processing",
        "model_key": model_key,
        "model_label": model_info["label"],
        "garment_type": garment_type,
    })


@router.get("/studio/generate-status")
async def check_generation_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    session_id: str = Query(default=""),
) -> JSONResponse:
    session_id = session_id.strip()
    if session_id == "":
        return JSONResponse({"error": "session_id is required"}, status_code=400)

    row = await gs.find_by_id(db, session_id)
    if row is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    if row.status == "completed":
        return JSONResponse({"status": "completed", "session_id": session_id, "result_image": row.result_image_url})
    if row.status == "failed":
        return JSONResponse({
            "status": "failed", "session_id": session_id,
            "error": row.error_message, "raw_error": row.error_message,
        })

    prediction_id = (row.fashn_prediction_id or "").strip()
    if prediction_id == "":
        return JSONResponse({"status": "processing", "session_id": session_id})

    requested_at = row.api_request_at
    if requested_at is not None and (datetime.utcnow() - requested_at) > timedelta(seconds=180):
        await gs.update_status(db, session_id, "failed", error_message="Generation timed out. Please try again.")
        return JSONResponse({
            "status": "failed", "session_id": session_id,
            "error": "Generation timed out. Please try again.",
        })

    settings = get_settings()
    fashn_client = FashnClient(settings.fashn_api_key)
    check = await fashn_client.check_status(prediction_id)

    if check["job_status"] in ("processing", "error"):
        return JSONResponse({"status": "processing", "session_id": session_id})

    if check["job_status"] == "failed":
        raw_error = check.get("error_details") or "Try-on API request failed"
        await gs.update_status(db, session_id, "failed", error_message=raw_error, api_response_at=datetime.utcnow())
        return JSONResponse({
            "status": "failed", "session_id": session_id,
            "error": gs.user_friendly_error(400, raw_error),
            "raw_error": raw_error,
        })

    filename = f"studio_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}.jpg"
    (storage_service.results_dir() / filename).write_bytes(check["image_bytes"])

    result_url = f"{base_url(request)}{base_path(request)}/results/{filename}"
    latency_ms = int((datetime.utcnow() - requested_at).total_seconds() * 1000) if requested_at else None

    await gs.update_status(
        db, session_id, "completed",
        result_image_url=result_url, api_response_at=datetime.utcnow(), api_latency_ms=latency_ms,
    )

    return JSONResponse({"status": "completed", "session_id": session_id, "result_image": result_url})


@router.get("/studio/models")
async def get_models(request: Request) -> JSONResponse:
    models_dir = storage_service.models_dir()
    listing: dict[str, dict] = {}
    for key, info in gs.MODELS.items():
        rel_path = f"{info['gender']}/{key}.jpg"
        abs_path = models_dir / info["gender"] / f"{key}.jpg"
        exists = abs_path.is_file()
        listing[key] = {
            "key": key,
            "label": info["label"],
            "gender": info["gender"],
            "image_exists": exists,
            "image_url": f"{base_url(request)}{base_path(request)}/models/{rel_path}" if exists else None,
            "image_hash": _md5_file(abs_path) if exists else None,
        }
    return JSONResponse({"models": listing})


def _md5_file(path) -> str:
    import hashlib
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@router.get("/studio/session")
async def get_session(db: AsyncSession = Depends(get_db), session_id: str = Query(default="")) -> JSONResponse:
    session_id = session_id.strip()
    if session_id == "":
        return JSONResponse({"error": "session_id is required"}, status_code=400)
    row = await gs.find_by_id(db, session_id)
    if row is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse(gs.session_to_dict(row))


@router.get("/studio/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    limit: int = Query(default=20),
    offset: int = Query(default=0),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    limit = min(50, max(1, limit))
    offset = max(0, offset)
    rows = await gs.list_by_merchant(db, merchant.id, limit, offset)
    return JSONResponse({"sessions": [gs.session_to_dict(r) for r in rows]})


@router.get("/studio/setup-check")
async def setup_check() -> JSONResponse:
    models_base = storage_service.models_dir()
    base_exists = models_base.is_dir()

    uploaded = 0
    for key, info in gs.MODELS.items():
        if (models_base / info["gender"] / f"{key}.jpg").is_file():
            uploaded += 1

    return JSONResponse({
        "ok": base_exists,
        "models_dir": str(models_base),
        "dir_exists": base_exists,
        "dir_writable": base_exists,
        "gd_available": True,
        "uploaded_count": uploaded,
        "total_models": len(gs.MODELS),
        "issues": [],
    })


@router.post("/studio/save-gallery")
async def save_gallery(db: AsyncSession = Depends(get_db), payload: dict = Body(...)) -> JSONResponse:
    session_id = str(payload.get("session_id") or "").strip()
    if session_id == "":
        return JSONResponse({"error": "session_id is required"}, status_code=400)
    await gs.mark_saved_to_gallery(db, session_id)
    return JSONResponse({"ok": True})


@router.post("/studio/set-model-image")
async def set_model_image(
    request: Request,
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(...),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    model_key = str(payload.get("model_key") or "").strip()
    image_url = str(payload.get("image_url") or "").strip()

    if model_key not in gs.MODELS:
        return JSONResponse({"error": "Invalid model_key", "valid_keys": list(gs.MODELS.keys())}, status_code=400)
    if image_url == "":
        return JSONResponse({"error": "image_url is required"}, status_code=400)

    image_bytes = await image_service.fetch_image_bytes(image_url)
    if image_bytes is None:
        return JSONResponse({"error": "Failed to download image"}, status_code=400)

    gender = gs.MODELS[model_key]["gender"]
    dest_dir = storage_service.models_dir() / gender
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{model_key}.jpg"

    jpeg_bytes = image_service.reencode_as_jpeg(image_bytes)
    dest_path.write_bytes(jpeg_bytes)

    permanent_url = f"{base_url(request)}{base_path(request)}/models/{gender}/{model_key}.jpg"

    return JSONResponse({
        "ok": True,
        "model_key": model_key,
        "model_label": gs.MODELS[model_key]["label"],
        "gender": gender,
        "image_url": permanent_url,
    })


@router.delete("/studio/model-image")
async def delete_model_image(
    merchant: Merchant | None = Depends(resolve_merchant_by_shop),
    payload: dict = Body(default={}),
) -> JSONResponse:
    if merchant is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    model_key = str(payload.get("model_key") or "").strip()
    if model_key not in gs.MODELS:
        return JSONResponse({"error": "Invalid model_key"}, status_code=400)

    gender = gs.MODELS[model_key]["gender"]
    path = storage_service.models_dir() / gender / f"{model_key}.jpg"
    if path.is_file():
        path.unlink()

    return JSONResponse({"ok": True, "model_key": model_key})
